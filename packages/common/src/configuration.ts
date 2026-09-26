import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { normalizeListmonkApiUrl } from "./listmonk-url";

export type ConfigurationSource = { kind: "default" | "environment" | "argument" | "profile" | "programmatic"; name?: string };
export interface ListmonkConfigurationSummary {
	profile?: string;
	configFile?: string;
	availableProfiles: string[];
	baseUrl: string;
	username: string;
	dataDirectory: string;
	sources: { baseUrl: ConfigurationSource; username: ConfigurationSource; dataDirectory: ConfigurationSource };
	authentication: { kind: "token" | "legacy_password" | "none"; source: ConfigurationSource; reference?: string };
}
export interface ResolvedListmonkConfiguration {
	summary: ListmonkConfigurationSummary;
	/** Read on every operation so atomic token-file replacement does not require a restart. */
	readCredential(): Promise<string | undefined>;
}
export interface ListmonkConfigurationOptions {
	profile?: string;
	configFile?: string;
	baseUrl?: string;
	username?: string;
	tokenFile?: string;
	apiToken?: string;
	password?: string;
	allowLegacyPassword?: boolean;
	env?: Readonly<Record<string, string | undefined>>;
	homeDirectory?: string;
	workingDirectory?: string;
}
interface Profile {
	baseUrl: string;
	username: string;
	tokenEnv?: string;
	tokenFile?: string;
	dataDirectory?: string;
}
interface ProfileDocument {
	schemaVersion: 1;
	defaultProfile?: string;
	profiles: Record<string, Profile>;
}
const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface ConfiguredPathOptions {
	/** Anchor for a relative path. Defaults to the home directory. */
	baseDirectory?: string;
	homeDirectory?: string;
}

/**
 * The one rule for user-configured paths: surrounding whitespace is ignored,
 * a leading `~` or `~/` expands to the home directory (MCP client JSON
 * configs are not shell-expanded), absolute paths are kept as written, and
 * relative paths resolve from `baseDirectory` — the home directory unless the
 * caller anchors them to a profile file or an explicit command-line cwd.
 * Anchoring environment paths to the home directory rather than
 * `process.cwd()` keeps a CLI run from any directory and an MCP server started
 * elsewhere on the same state files.
 */
export function resolveConfiguredPath(
	value: string,
	options: ConfiguredPathOptions = {},
): string {
	const home = options.homeDirectory ?? homedir();
	const trimmed = value.trim();
	if (trimmed === "~") return home;
	if (trimmed.startsWith("~/")) return resolve(home, trimmed.slice(2));
	return isAbsolute(trimmed)
		? trimmed
		: resolve(options.baseDirectory ?? home, trimmed);
}

export function getListmonkDataDirectory(): string {
	const selected = process.env.LISTMONK_OPS_DATA_DIR?.trim();
	return selected
		? resolveConfiguredPath(selected)
		: join(homedir(), ".listmonk-ops");
}

const FILE_ERROR_DESCRIPTIONS: Readonly<Record<string, string>> = {
	ENOENT: "file does not exist",
	EACCES: "permission denied",
	EPERM: "permission denied",
	ENOTDIR: "a parent path is not a directory",
	ELOOP: "too many symbolic links",
};

function fileErrorCode(error: unknown): string | undefined {
	return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
		? error.code
		: undefined;
}

/** ` (ENOENT: file does not exist)` for an errno failure; never file contents. */
function describeFileError(error: unknown): string {
	const code = fileErrorCode(error);
	if (code === undefined) return "";
	const description = FILE_ERROR_DESCRIPTIONS[code];
	return description === undefined
		? ` (${code})`
		: ` (${code}: ${description})`;
}

/** Bound allocation and reject non-regular files without blocking on a FIFO. */
async function readConfigurationFile(path: string, limit: number, label: string, optional = false): Promise<string | undefined> {
	let handle;
	try {
		handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
	} catch (error) {
		if (optional && fileErrorCode(error) === "ENOENT") return undefined;
		throw new Error(
			`Unable to open ${label} ${path}${describeFileError(error)}`,
			{ cause: error },
		);
	}
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || stat.size > limit) throw new Error(`Invalid ${label}`);
		const buffer = Buffer.alloc(limit + 1);
		let size = 0;
		while (size <= limit) {
			const { bytesRead } = await handle.read(
				buffer,
				size,
				buffer.length - size,
				null,
			);
			if (bytesRead === 0) break;
			size += bytesRead;
		}
		if (size > limit) throw new Error(`Invalid ${label}`);
		return new TextDecoder("utf-8", { fatal: true }).decode(
			buffer.subarray(0, size),
		);
	} catch (error) {
		// Only the path and errno code are reported; the contents never are.
		throw new Error(
			`Unable to read ${label} ${path}${describeFileError(error)}: expected a bounded regular file`,
			{ cause: error },
		);
	} finally {
		await handle.close();
	}
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function textField(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}
function canonicalUrl(value: string): string {
	try {
		const normalized = normalizeListmonkApiUrl(value);
		const url = new URL(normalized);
		if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
		return normalized;
	} catch {
		throw new Error(
		"Listmonk API URL must be an http(s) URL without credentials, query, or fragment",
	);
	}
}
function username(value: string): string {
	const normalized = value.trim();
	if (!normalized || /[:\s\u0000-\u001f\u007f]/u.test(normalized)) throw new Error("Invalid Listmonk username");
	return normalized;
}
function parseProfiles(content: string): ProfileDocument {
	let value: unknown;
	try {
		value = JSON.parse(content);
	} catch {
		throw new Error("Invalid Listmonk profile configuration JSON");
	}
	if (!record(value) || value.schemaVersion !== 1 || !record(value.profiles)
		|| Object.keys(value).some((key) => !["schemaVersion", "defaultProfile", "profiles"].includes(key))
		|| Object.keys(value.profiles).length > 64) throw new Error("Invalid Listmonk profile configuration schema");
	const profiles: Record<string, Profile> = Object.create(null);
	for (const [name, raw] of Object.entries(value.profiles)) {
		if (!PROFILE_NAME.test(name) || !record(raw) || !textField(raw.baseUrl) || !textField(raw.username)
			|| Object.keys(raw).some((key) => !["baseUrl", "username", "tokenEnv", "tokenFile", "dataDirectory"].includes(key))
			|| (raw.tokenEnv !== undefined && (!textField(raw.tokenEnv) || !ENV_NAME.test(raw.tokenEnv)))
			|| (raw.tokenFile !== undefined && !textField(raw.tokenFile))
			|| (raw.dataDirectory !== undefined && !textField(raw.dataDirectory))
			|| (raw.tokenEnv !== undefined && raw.tokenFile !== undefined)) throw new Error("Invalid Listmonk profile entry");
		profiles[name] = {
			baseUrl: canonicalUrl(raw.baseUrl), username: username(raw.username),
			...(typeof raw.tokenEnv === "string" ? { tokenEnv: raw.tokenEnv } : {}),
			...(typeof raw.tokenFile === "string" ? { tokenFile: raw.tokenFile } : {}),
			...(typeof raw.dataDirectory === "string" ? { dataDirectory: raw.dataDirectory } : {}),
		};
	}
	if (value.defaultProfile !== undefined && (typeof value.defaultProfile !== "string" || !Object.hasOwn(profiles, value.defaultProfile))) throw new Error("Invalid default Listmonk profile");
	return {
		schemaVersion: 1,
		profiles,
		...(typeof value.defaultProfile === "string" ? { defaultProfile: value.defaultProfile } : {}),
	};
}
/** Name the requested profile and the ones that exist; never echo an invalid name. */
function describeMissingProfile(input: {
	name: string;
	selectedBy?: string;
	configFile: string;
	configFileFound: boolean;
	available: readonly string[];
}): string {
	const origin = input.selectedBy === undefined
		? ""
		: ` (selected by ${input.selectedBy})`;
	if (!PROFILE_NAME.test(input.name)) {
		return `Requested Listmonk profile name${origin} is invalid: use 1-64 letters, digits, "_", or "-", starting with a letter or digit`;
	}
	const requested = `Requested Listmonk profile "${input.name}"${origin} does not exist`;
	if (!input.configFileFound) return `${requested}: no profile configuration file was found at ${input.configFile}`;
	if (input.available.length === 0) return `${requested}: ${input.configFile} defines no profiles`;
	return `${requested} in ${input.configFile}; available profiles: ${[...input.available].sort().join(", ")}`;
}
function credentialValue(value: string | undefined): string | undefined {
	if (value === undefined || value.trim() === "") return undefined;
	const normalized = value.trim();
	if (normalized.length > 16_384 || /[\s\u0000-\u001f\u007f]/u.test(normalized)) throw new Error("Invalid Listmonk authentication value");
	return normalized;
}
function legacyPasswordValue(value: string | undefined): string | undefined {
	if (value === undefined || value.length === 0) return undefined;
	if (value.length > 16_384 || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error("Invalid Listmonk authentication value");
	return value;
}

/** One connection resolver for CLI and MCP. A selected profile never inherits legacy connection env fields. */
export async function resolveListmonkConfiguration(options: ListmonkConfigurationOptions = {}): Promise<ResolvedListmonkConfiguration> {
	const env = options.env ?? process.env;
	const home = options.homeDirectory ?? homedir();
	const cwd = options.workingDirectory ?? process.cwd();
	const configuredPath = options.configFile ?? (env.LISTMONK_OPS_CONFIG?.trim() || undefined);
	const path = resolveConfiguredPath(
		configuredPath ?? join(home, ".listmonk-ops", "config.json"),
		{ baseDirectory: cwd, homeDirectory: home },
	);
	const content = await readConfigurationFile(
		path,
		262_144,
		"Listmonk profile configuration",
		configuredPath === undefined,
	);
	const document = content === undefined
		? { schemaVersion: 1 as const, profiles: {} as Record<string, Profile> }
		: parseProfiles(content);
	const profileName = options.profile ?? (env.LISTMONK_OPS_PROFILE?.trim() || undefined) ?? document.defaultProfile;
	if (profileName !== undefined && (!PROFILE_NAME.test(profileName) || !Object.hasOwn(document.profiles, profileName))) {
		// A valid defaultProfile always exists, so the name came from the
		// caller or from LISTMONK_OPS_PROFILE (possibly via a Bun-loaded .env).
		throw new Error(describeMissingProfile({
			name: profileName,
			...(options.profile === undefined ? { selectedBy: "LISTMONK_OPS_PROFILE" } : {}),
			configFile: path,
			configFileFound: content !== undefined,
			available: Object.keys(document.profiles),
		}));
	}
	const profile = profileName === undefined
		? undefined
		: document.profiles[profileName];
	const source = (field: string): ConfigurationSource => ({
		kind: "profile",
		name: `${profileName}.${field}`,
	});
	const field = (override: string | undefined, profileValue: string | undefined, envName: string, fallback: string, profileField: string) => {
		if (override !== undefined) return { value: override, source: { kind: "argument" as const, name: profileField } };
		if (profileValue !== undefined) return { value: profileValue, source: source(profileField) };
		if (profile === undefined && env[envName]?.trim()) return { value: env[envName]!, source: { kind: "environment" as const, name: envName } };
		return { value: fallback, source: { kind: "default" as const } };
	};
	const url = field(
		options.baseUrl,
		profile?.baseUrl,
		"LISTMONK_API_URL",
		"http://localhost:9000/api",
		"baseUrl",
	);
	const user = field(
		options.username,
		profile?.username,
		"LISTMONK_USERNAME",
		"api-admin",
		"username",
	);
	const baseUrl = canonicalUrl(url.value);
	const resolvedUsername = username(user.value);
	let readCredential: () => Promise<string | undefined> = async () => undefined;
	let authentication: ListmonkConfigurationSummary["authentication"] = {
		kind: "none",
		source: { kind: "default" },
	};
	const selectFile = (value: string, selectedSource: ConfigurationSource, base: string) => {
		const reference = resolveConfiguredPath(value, {
			baseDirectory: base,
			homeDirectory: home,
		});
		authentication = { kind: "token", source: selectedSource, reference };
		readCredential = async () => {
			const token = credentialValue(await readConfigurationFile(reference, 16_384, "Listmonk token file"));
			if (!token) throw new Error("Listmonk token file is empty");
			return token;
		};
	};
	const selectEnv = (name: string, selectedSource: ConfigurationSource, kind: "token" | "legacy_password" = "token") => {
		authentication = { kind, source: selectedSource, reference: name };
		readCredential = async () => kind === "legacy_password" ? legacyPasswordValue(env[name]) : credentialValue(env[name]);
	};
	if (options.apiToken !== undefined && options.tokenFile !== undefined) throw new Error("Choose an API token or a token file, not both");
	if (options.tokenFile !== undefined) selectFile(options.tokenFile, { kind: "argument", name: "tokenFile" }, cwd);
	else if (options.apiToken !== undefined) {
		authentication = { kind: "token", source: { kind: "argument", name: "apiToken" } };
		readCredential = async () => credentialValue(options.apiToken);
	} else if (options.password !== undefined && options.allowLegacyPassword) {
		authentication = { kind: "legacy_password", source: { kind: "argument", name: "password" } };
		readCredential = async () => legacyPasswordValue(options.password);
	} else if (profile?.tokenFile !== undefined) selectFile(profile.tokenFile, source("tokenFile"), dirname(path));
	else if (profile?.tokenEnv !== undefined) selectEnv(profile.tokenEnv, source("tokenEnv"));
	else if (profile === undefined) {
		if (env.LISTMONK_API_TOKEN_FILE?.trim()) selectFile(env.LISTMONK_API_TOKEN_FILE, { kind: "environment", name: "LISTMONK_API_TOKEN_FILE" }, home);
		else if (env.LISTMONK_API_TOKEN?.trim()) selectEnv("LISTMONK_API_TOKEN", { kind: "environment", name: "LISTMONK_API_TOKEN" });
		else if (options.allowLegacyPassword && env.LISTMONK_PASSWORD) selectEnv("LISTMONK_PASSWORD", { kind: "environment", name: "LISTMONK_PASSWORD" }, "legacy_password");
	}
	let dataDirectory: string;
	let dataSource: ConfigurationSource;
	if (profile) {
		const identity = createHash("sha256").update(JSON.stringify([path, profileName, baseUrl, resolvedUsername])).digest("hex").slice(
			0,
			16,
		);
		dataDirectory = profile.dataDirectory === undefined ? join(home, ".listmonk-ops", "profiles", `${profileName}-${identity}`) : resolveConfiguredPath(profile.dataDirectory, { baseDirectory: dirname(path), homeDirectory: home });
		dataSource = profile.dataDirectory === undefined ? { kind: "default" } : source("dataDirectory");
	} else {
		dataDirectory = env.LISTMONK_OPS_DATA_DIR?.trim() ? resolveConfiguredPath(env.LISTMONK_OPS_DATA_DIR, { homeDirectory: home }) : join(home, ".listmonk-ops");
		dataSource = env.LISTMONK_OPS_DATA_DIR?.trim() ? { kind: "environment", name: "LISTMONK_OPS_DATA_DIR" } : { kind: "default" };
	}
	return {
		summary: {
			...(profileName === undefined ? {} : { profile: profileName }),
			...(content === undefined ? {} : { configFile: path }),
			availableProfiles: Object.keys(document.profiles).sort(),
			baseUrl,
			username: resolvedUsername,
			dataDirectory,
			sources: {
				baseUrl: url.source,
				username: user.source,
				dataDirectory: dataSource,
			},
			authentication,
		},
		readCredential,
	};
}
