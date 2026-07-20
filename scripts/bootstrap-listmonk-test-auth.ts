import { randomUUID } from "node:crypto";
import {
	appendFileSync,
	existsSync,
	lstatSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

const EXPECTED_LISTMONK_VERSION = "6.2.0";
const MANAGED_API_USER_NAME = "listmonk-ops local test API";
const apiUrl = (
	process.env.LISTMONK_API_URL || "http://localhost:9000/api"
).replace(/\/$/, "");
const bootstrapAdminUsername =
	process.env.LISTMONK_BOOTSTRAP_ADMIN_USERNAME ||
	process.env.LISTMONK_ADMIN_USER ||
	"admin";
const bootstrapAdminPassword =
	process.env.LISTMONK_BOOTSTRAP_ADMIN_PASSWORD ||
	process.env.LISTMONK_ADMIN_PASSWORD ||
	"adminpass";
const legacyBootstrapUsername = process.env.LISTMONK_BOOTSTRAP_USERNAME?.trim();
const legacyBootstrapToken = process.env.LISTMONK_BOOTSTRAP_TOKEN?.trim();
const targetUsername =
	process.env.LISTMONK_TEST_API_USERNAME?.trim() ||
	process.env.LISTMONK_USERNAME?.trim() ||
	"api-admin";
const tokenFile =
	process.env.LISTMONK_TEST_TOKEN_FILE || "/tmp/listmonk-ops-api-token";

const parsedApiUrl = new URL(apiUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(parsedApiUrl.hostname)) {
	throw new Error(
		`Refusing to bootstrap credentials for non-local URL ${apiUrl}`,
	);
}
if (!["http:", "https:"].includes(parsedApiUrl.protocol)) {
	throw new Error(`LISTMONK_API_URL must use HTTP or HTTPS: ${apiUrl}`);
}
if (!parsedApiUrl.pathname.replace(/\/+$/, "").endsWith("/api")) {
	throw new Error(`LISTMONK_API_URL must end with /api: ${apiUrl}`);
}

type ApiUser = {
	id: number;
	name?: string;
	username: string;
	type: string;
	password?: string;
};

function assertSingleLine(name: string, value: string): void {
	if (/\r|\n/.test(value)) {
		throw new Error(`${name} must not contain line breaks`);
	}
}

assertSingleLine("LISTMONK_API_URL", apiUrl);
assertSingleLine("LISTMONK_TEST_API_USERNAME", targetUsername);
assertSingleLine("LISTMONK_BOOTSTRAP_ADMIN_USERNAME", bootstrapAdminUsername);
assertSingleLine("LISTMONK_BOOTSTRAP_ADMIN_PASSWORD", bootstrapAdminPassword);
if (targetUsername.includes(":")) {
	throw new Error(
		"LISTMONK_TEST_API_USERNAME / LISTMONK_USERNAME must not contain ':'",
	);
}
if (Boolean(legacyBootstrapUsername) !== Boolean(legacyBootstrapToken)) {
	throw new Error(
		"LISTMONK_BOOTSTRAP_USERNAME and LISTMONK_BOOTSTRAP_TOKEN must be set together",
	);
}

function authHeader(username: string, token: string): string {
	return `token ${username}:${token}`;
}

type TokenAuth = {
	username: string;
	token: string;
};

function appEndpoint(path: string): string {
	const url = new URL(parsedApiUrl);
	const apiPath = url.pathname.replace(/\/+$/, "");
	url.pathname = `${apiPath.slice(0, -"/api".length)}${path}`;
	url.search = "";
	url.hash = "";
	return url.toString();
}

async function createAdminSessionCookie(): Promise<string> {
	const response = await fetch(appEndpoint("/admin/login"), {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			username: bootstrapAdminUsername,
			password: bootstrapAdminPassword,
			next: appEndpoint("/admin"),
		}),
		redirect: "manual",
	});
	const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];

	if (response.status < 300 || response.status >= 400 || !cookie) {
		throw new Error(
			`Listmonk admin login failed (${response.status}); check LISTMONK_BOOTSTRAP_ADMIN_USERNAME and LISTMONK_BOOTSTRAP_ADMIN_PASSWORD`,
		);
	}

	return cookie;
}

let bootstrapHeadersPromise: Promise<Record<string, string>> | undefined;

function getBootstrapHeaders(): Promise<Record<string, string>> {
	bootstrapHeadersPromise ??= createAdminSessionCookie()
		.then((cookie) => ({ Cookie: cookie }))
		.catch((error: unknown) => {
			if (legacyBootstrapUsername && legacyBootstrapToken) {
				console.warn(
					"Admin login failed; falling back to explicitly configured legacy bootstrap credentials",
				);
				return {
					Authorization: authHeader(
						legacyBootstrapUsername,
						legacyBootstrapToken,
					),
				};
			}
			throw error;
		});

	return bootstrapHeadersPromise;
}

async function requestJson<T>(
	path: string,
	init: RequestInit = {},
	auth?: TokenAuth,
): Promise<T> {
	const authHeaders =
		auth !== undefined
			? { Authorization: authHeader(auth.username, auth.token) }
			: await getBootstrapHeaders();
	const response = await fetch(`${apiUrl}${path}`, {
		...init,
		headers: {
			...authHeaders,
			...(init.body ? { "Content-Type": "application/json" } : {}),
			...init.headers,
		},
	});

	if (!response.ok) {
		const detail = await response.text();
		throw new Error(
			`${init.method || "GET"} ${path} failed (${response.status}): ${detail}`,
		);
	}

	return (await response.json()) as T;
}

async function tokenIsValid(token: string): Promise<boolean> {
	try {
		await requestJson(
			"/lists?page=1&per_page=1",
			{},
			{ username: targetUsername, token },
		);
		return true;
	} catch {
		return false;
	}
}

function persistToken(token: string): void {
	assertSingleLine("LISTMONK_API_TOKEN", token);

	const temporaryTokenFile = join(
		dirname(tokenFile),
		`.${basename(tokenFile)}.${process.pid}.${randomUUID()}.tmp`,
	);
	let tokenPersisted = false;
	try {
		writeFileSync(temporaryTokenFile, `${token}\n`, {
			encoding: "utf8",
			flag: "wx",
			mode: 0o600,
		});
		renameSync(temporaryTokenFile, tokenFile);
		tokenPersisted = true;
	} finally {
		if (!tokenPersisted && existsSync(temporaryTokenFile)) {
			unlinkSync(temporaryTokenFile);
		}
	}

	if (process.env.GITHUB_ACTIONS === "true") {
		console.log(`::add-mask::${token}`);
	}

	if (process.env.GITHUB_ENV) {
		appendFileSync(
			process.env.GITHUB_ENV,
			`LISTMONK_API_URL=${apiUrl}\nLISTMONK_USERNAME=${targetUsername}\nLISTMONK_API_TOKEN=${token}\n`,
		);
	}
}

function readCachedToken(): string | undefined {
	if (!existsSync(tokenFile)) {
		return undefined;
	}

	const stats = lstatSync(tokenFile);
	if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o077) !== 0) {
		console.warn(
			`Ignoring unsafe token cache ${tokenFile}; expected a regular file with mode 0600`,
		);
		return undefined;
	}

	const cachedToken = readFileSync(tokenFile, "utf8").trim();
	return cachedToken || undefined;
}

const suppliedToken = process.env.LISTMONK_API_TOKEN?.trim();
if (suppliedToken && (await tokenIsValid(suppliedToken))) {
	persistToken(suppliedToken);
	console.log(`Validated Listmonk API token for ${targetUsername}`);
	process.exit(0);
}

const cachedToken = readCachedToken();
if (cachedToken && (await tokenIsValid(cachedToken))) {
	persistToken(cachedToken);
	console.log(`Reused local Listmonk API token for ${targetUsername}`);
	process.exit(0);
}

const about = await requestJson<{ version?: string }>("/about");
if (about.version?.replace(/^v/, "") !== EXPECTED_LISTMONK_VERSION) {
	throw new Error(
		`Expected Listmonk ${EXPECTED_LISTMONK_VERSION}, received ${about.version || "unknown"}`,
	);
}

const usersResponse = await requestJson<{ data?: ApiUser[] }>("/users");
const existingUser = usersResponse.data?.find(
	(user) => user.username === targetUsername && user.type === "api",
);
if (existingUser) {
	if (existingUser.name !== MANAGED_API_USER_NAME) {
		throw new Error(
		`Refusing to replace existing API user "${targetUsername}" because it is not managed by listmonk-ops. Set LISTMONK_TEST_API_USERNAME (or LISTMONK_USERNAME) to a dedicated test username.`,
		);
	}
	await requestJson(`/users/${existingUser.id}`, { method: "DELETE" });
}

const createResponse = await requestJson<{ data?: ApiUser }>("/users", {
	method: "POST",
	body: JSON.stringify({
		username: targetUsername,
		name: MANAGED_API_USER_NAME,
		type: "api",
		status: "enabled",
		user_role_id: 1,
	}),
});
const generatedToken = createResponse.data?.password;
if (!generatedToken) {
	throw new Error("Listmonk did not return the one-time API token");
}
if (!(await tokenIsValid(generatedToken))) {
	throw new Error("Listmonk rejected the newly generated API token");
}

persistToken(generatedToken);
console.log(
	`Provisioned ${targetUsername} for Listmonk ${EXPECTED_LISTMONK_VERSION}; token saved to ${tokenFile}`,
);
