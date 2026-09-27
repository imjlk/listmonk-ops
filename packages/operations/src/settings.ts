import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	bindSettingsGetOperationSpec,
	bindSettingsTestSmtpOperationSpec,
} from "./specs";
import { z } from "zod";
import { defineOperationCatalog } from "./catalog";
import {
	defineOperation,
	normalizeOperationExecutionError,
	parseOperationInput,
	parseOperationOutput,
} from "./operation";
import {
	createResourceSafety,
	jsonResourceValue,
	readResourceSafety,
	ResourceResponseError,
	unwrapResourceResponse,
} from "./resource-helpers";

export interface SettingsOperationContext {
	client: Pick<ListmonkClient, "settings">;
}

const settingsGetOutputSchema = z.object({
	settings: z.record(z.string(), z.unknown()),
});

export type SettingsDocument = z.output<typeof settingsGetOutputSchema>;

/** Marker substituted for every credential-bearing field. */
export const SETTINGS_REDACTED_VALUE = "[redacted]";

/**
 * Field names whose values are credentials, matched case-insensitively
 * against a key's last dotted segment. The nested Listmonk 6.2 document
 * (`"bounce.forwardemail": { "key": … }`) and a flattened key
 * (`"bounce.forwardemail.key"`) therefore redact alike. OAuth client ids
 * and other non-secret identifiers stay visible because operators need
 * them to correlate configurations.
 */
const CREDENTIAL_FIELD_NAMES = new Set([
	"key",
	"api_key",
	"apikey",
	"token",
	"access_key",
	"aws_access_key_id",
	"aws_secret_access_key",
	"sendgrid_key",
	"private_key",
	"password",
	"client_secret",
	"secret",
]);

/**
 * Credential fragments matched anywhere in a key, so namespaced settings
 * keys like "bounce.sendgrid_key" or "upload.s3.aws_secret_access_key"
 * redact without enumerating every prefix.
 */
const CREDENTIAL_SUBSTRINGS = [
	"password",
	"secret",
	"api_key",
	"access_key",
	"sendgrid_key",
	"forwardemail_key",
	"private_key",
	"token",
	// Auth usernames are credential halves. Listmonk 6.2 returns the
	// `username` of every SMTP server, messenger, and bounce mailbox and of
	// the nested `bounce.postmark` webhook block unmasked, yet Postmark uses
	// its server token as that username and SES SMTP usernames derive from
	// IAM access keys.
	"username",
] as const;

function isCredentialFieldName(name: string): boolean {
	const lowered = name.toLowerCase();
	const lastSegment = lowered.slice(lowered.lastIndexOf(".") + 1);
	if (CREDENTIAL_FIELD_NAMES.has(lastSegment)) return true;
	return CREDENTIAL_SUBSTRINGS.some((needle) => lowered.includes(needle));
}

/**
 * Query parameter name tokens that carry credentials in a URL beyond the
 * settings field names above: request signatures and signing scopes (AWS
 * SigV4 `X-Amz-Signature` and `X-Amz-Credential`, Azure SAS `sig`), session
 * ids, and the `user`/`pass` pairs SMS and webhook gateways accept in a
 * messenger's postback URL. Any token ending in "key" also counts, so
 * `api-key`, `apiKey`, and `X-Api-Key` match alike.
 */
const URL_CREDENTIAL_PARAMETER_TOKENS = new Set([
	"auth",
	"authorization",
	"credential",
	"credentials",
	"hmac",
	"jwt",
	"login",
	"pass",
	"passphrase",
	"passwd",
	"pwd",
	"sessid",
	"session",
	"sessionid",
	"sig",
	"signature",
	"user",
]);

/**
 * The start of an absolute URL with an authority: an RFC 3986 scheme and
 * `//` (or the `\\` WHATWG parsers accept for special schemes). Requiring
 * the authority keeps `mailto:` addresses, hostnames, email addresses, and
 * CSS rules such as `a:hover` out.
 */
const ABSOLUTE_URL_PREFIX = /^[a-z][a-z0-9+.-]*:[\\/]{2}/i;
const ABSOLUTE_URL_PREFIX_ANYWHERE = /[a-z][a-z0-9+.-]*:[\\/]{2}/i;

function findAbsoluteUrlPrefix(
	value: string,
	fromIndex = 0,
): { index: number; prefix: string } | undefined {
	const match = ABSOLUTE_URL_PREFIX_ANYWHERE.exec(value.slice(fromIndex));
	if (match === null || match.index === undefined) return undefined;
	return { index: fromIndex + match.index, prefix: match[0] };
}

/** WHATWG special schemes, whose authority a "\" also ends. */
const SPECIAL_URL_SCHEMES = new Set([
	"file:",
	"ftp:",
	"http:",
	"https:",
	"ws:",
	"wss:",
]);

/**
 * How many following tokens a userinfo with unencoded spaces may span,
 * which covers a passphrase of up to nine words and bounds how much text
 * after a broken URL can be folded into its redaction.
 */
const MAX_SPACED_USERINFO_TOKENS = 8;

function decodeQueryParameterName(encodedName: string): string {
	try {
		return decodeURIComponent(encodedName.replace(/\+/g, " "));
	} catch {
		return encodedName;
	}
}

function isCredentialQueryParameter(encodedName: string): boolean {
	const name = decodeQueryParameterName(encodedName)
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.toLowerCase();
	if (isCredentialFieldName(name)) return true;
	return name
		.split(/[^a-z0-9]+/)
		.some(
			(token) =>
				token.endsWith("key") || URL_CREDENTIAL_PARAMETER_TOKENS.has(token),
		);
}

/**
 * Replace the value of every credential-named parameter in `text`, split
 * on `separators` (a capturing pattern, so the separators are kept). The
 * original text of every other parameter is kept.
 */
function redactCredentialParameters(text: string, separators: RegExp): string {
	const parts = text.split(separators);
	let redacted = false;
	for (let index = 0; index < parts.length; index += 2) {
		const parameter = parts[index] ?? "";
		const separator = parameter.indexOf("=");
		if (separator <= 0 || separator === parameter.length - 1) continue;
		if (!isCredentialQueryParameter(parameter.slice(0, separator))) continue;
		const value = parameter.slice(separator + 1);
		// The nested-query pass can see a value already replaced by this
		// function. Keep the marker (and any URL wrapper after it) idempotent.
		if (isAlreadyRedactedCredentialValue(value)) {
			continue;
		}
		const suffix = /[)\]}>'",]+$/.exec(value)?.[0] ?? "";
		parts[index] = `${parameter.slice(0, separator + 1)}${SETTINGS_REDACTED_VALUE}${suffix}`;
		redacted = true;
	}
	return redacted ? parts.join("") : text;
}

function isAlreadyRedactedCredentialValue(value: string): boolean {
	return (
		value.startsWith(SETTINGS_REDACTED_VALUE) &&
		/^[)\]}>'",]*$/.test(value.slice(SETTINGS_REDACTED_VALUE.length))
	);
}

/**
 * Redact the credential parameters of a query or fragment body. The first
 * pass splits on "&" and the legacy ";", so a value that contains "?" is
 * redacted whole; the second also splits on "?", which catches a
 * credential parameter nested in another value (`next=/home?token=…`) or
 * following a client-side route (`/welcome?token=…`).
 */
function redactCredentialParameterList(body: string): string {
	return redactCredentialParameters(
		redactCredentialParameters(body, /([&;])/),
		/([&;?])/,
	);
}

function redactCredentialQuery(query: string): string {
	if (query.length <= 1) return query;
	return `?${redactCredentialParameterList(query.slice(1))}`;
}

/**
 * Redact credential-named parameters in a fragment the same way, which
 * covers parameter-shaped fragments (`#access_token=…`) and client-side
 * route queries (`#/welcome?token=…`); any other fragment is kept.
 */
function redactCredentialFragment(fragment: string): string {
	if (fragment.length <= 1) return fragment;
	return `#${redactCredentialParameterList(fragment.slice(1))}`;
}

/**
 * Redact complete credential query values before URL scanning splits on
 * whitespace. Some Listmonk settings contain unencoded values such as
 * `?token=correct horse battery&to=1`; the value ends at an explicit query
 * separator, not at the first space. An absolute URL used as the value of a
 * credential parameter is also consumed as part of that same secret. A later
 * absolute URL bounds an unseparated value; text before that URL is redacted
 * as part of the credential value.
 */
function redactSpacedCredentialParameterValues(value: string): string {
	const replacements: Array<{ start: number; end: number }> = [];
	let scanFrom = 0;
	while (scanFrom < value.length) {
		const delimiterPattern = /[?&#;]/g;
		delimiterPattern.lastIndex = scanFrom;
		const delimiter = delimiterPattern.exec(value);
		if (delimiter === null || delimiter.index === undefined) break;

		const nameStart = delimiter.index + 1;
		let equals = -1;
		for (let index = nameStart; index < value.length; index += 1) {
			const character = value[index];
			if (character === "=") {
				equals = index;
				break;
			}
			if (character === undefined || /[\s?&#;]/.test(character)) break;
		}
		if (equals === -1) {
			scanFrom = nameStart;
			continue;
		}

		const name = value.slice(nameStart, equals);
		if (!isCredentialQueryParameter(name)) {
			scanFrom = equals + 1;
			continue;
		}

		const valueStart = equals + 1;
		const endPattern = /[&;#?]/g;
		endPattern.lastIndex = valueStart;
		const nextSeparator = endPattern.exec(value);
		const explicitValueEnd = nextSeparator?.index ?? value.length;
		const wrapperPattern = /[)\]}>'\",](?=\s|$)/g;
		wrapperPattern.lastIndex =
			valueStart +
			(value.startsWith(SETTINGS_REDACTED_VALUE, valueStart)
				? SETTINGS_REDACTED_VALUE.length
				: 0);
		const wrapperEnd = wrapperPattern.exec(value);
		const nextUrl = findAbsoluteUrlPrefix(value, valueStart);
		const nextUrlBoundary =
			nextUrl !== undefined &&
			nextUrl.index > valueStart &&
			/\S/.test(value.slice(valueStart, nextUrl.index))
				? nextUrl.index
				: undefined;
		const valueEnd = Math.min(
			explicitValueEnd,
			nextUrlBoundary ?? explicitValueEnd,
			wrapperEnd?.index ?? explicitValueEnd,
		);
		const parameterValue = value.slice(valueStart, valueEnd);
		if (!isAlreadyRedactedCredentialValue(parameterValue)) {
			let secretEnd = valueEnd;
			while (
				secretEnd > valueStart &&
				/[)\]}>'",\s]/.test(value[secretEnd - 1] ?? "")
			) {
				secretEnd -= 1;
			}
			if (secretEnd > valueStart) {
				replacements.push({ start: valueStart, end: secretEnd });
			}
		}
		// Resume at the separator or next URL boundary so following credentials
		// can still be scanned after the preceding value is replaced.
		scanFrom = valueEnd;
	}

	if (replacements.length === 0) return value;
	let redacted = value;
	for (const replacement of replacements.reverse()) {
		redacted = `${redacted.slice(0, replacement.start)}${SETTINGS_REDACTED_VALUE}${redacted.slice(replacement.end)}`;
	}
	return redacted;
}

function parseUrl(text: string): URL | undefined {
	try {
		return new URL(text);
	} catch {
		return undefined;
	}
}

/**
 * The index in `rest`, the text after `scheme://`, of the "@" that ends
 * the userinfo, or -1. For a URL the WHATWG parser accepts, that is the
 * last "@" of the authority whenever the parser reports a username or
 * password. A URL it rejects, such as one with a mistyped port or an
 * unencoded "/" in its password, is treated as having userinfo up to its
 * last "@": a broken URL may lose some of its visible host, but not its
 * userinfo.
 */
function userinfoEnd(prefix: string, rest: string): number {
	const url = parseUrl(`${prefix}${rest}`);
	if (url === undefined) return rest.lastIndexOf("@");
	if (url.username === "" && url.password === "") return -1;
	const authorityEnd = rest.search(
		SPECIAL_URL_SCHEMES.has(url.protocol) ? /[/?#\\]/ : /[/?#]/,
	);
	const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
	const at = authority.lastIndexOf("@");
	return at > 0 ? at : rest.lastIndexOf("@");
}

/**
 * Redact one absolute URL in place: its userinfo becomes `[redacted]@` and
 * the values of its credential-named query and fragment parameters become
 * `[redacted]`. Everything else, down to letter case, ports, and
 * percent-encoding, is kept as written.
 */
function redactAbsoluteUrl(prefix: string, rest: string): string {
	const at = userinfoEnd(prefix, rest);
	const userinfo = at > 0 ? `${SETTINGS_REDACTED_VALUE}@` : "";
	const location = at > 0 ? rest.slice(at + 1) : rest;
	const hashStart = location.indexOf("#");
	const fragment = hashStart === -1 ? "" : location.slice(hashStart);
	const beforeFragment =
		hashStart === -1 ? location : location.slice(0, hashStart);
	const queryStart = beforeFragment.indexOf("?");
	const path =
		queryStart === -1 ? beforeFragment : beforeFragment.slice(0, queryStart);
	const query = queryStart === -1 ? "" : beforeFragment.slice(queryStart);
	return `${prefix}${userinfo}${path}${redactCredentialQuery(query)}${redactCredentialFragment(fragment)}`;
}

/**
 * The index of the token that ends a URL whose userinfo contains unencoded
 * whitespace, such as the passphrase in `https://user:correct horse@host/`.
 * Only a URL token that is a bare `name:value` authority, without "@",
 * "/", "?", "#", or "\", can continue, and a "/", "?", or "#" before the
 * "@" that closes it belongs to the passphrase. If the parser rejects the
 * token, it continues through the first of the next few tokens that
 * contains "@". If it parses as `host:port`, a later token continues the
 * userinfo only when its suffix resembles a URL path, port, or bare service
 * host, so ordinary text and email addresses after `http://listmonk:9000`
 * are kept.
 */
function spacedUserinfoEnd(
	tokens: readonly string[],
	index: number,
	prefix: string,
): number {
	const token = tokens[index] ?? "";
	const authority = token.slice(prefix.length);
	if (!authority.includes(":") || /[@/?#\\]/.test(authority)) return index;
	if (parseUrl(token) !== undefined) {
		const last = Math.min(
			tokens.length - 1,
			index + 2 * MAX_SPACED_USERINFO_TOKENS,
		);
		for (let next = index + 2; next <= last; next += 2) {
			const candidate = tokens[next] ?? "";
			if (ABSOLUTE_URL_PREFIX.test(candidate)) return index;
			const at = candidate.indexOf("@");
			if (at === -1) continue;
			const hostAndPath = candidate.slice(at + 1);
			// After one or more passphrase words, require URL authority/path
			// syntax or a bare service host so ordinary prose stays
			// untouched while pathless URLs are still covered.
			return (
				next === index + 2 ||
				/[/?#\\]/.test(hostAndPath) ||
				/:\d/.test(hostAndPath) ||
				isBareUrlHost(hostAndPath)
			)
				? next
				: index;
		}
		return index;
	}
	const last = Math.min(
		tokens.length - 1,
		index + 2 * MAX_SPACED_USERINFO_TOKENS,
	);
	for (let next = index + 2; next <= last; next += 2) {
		const candidate = tokens[next] ?? "";
		if (ABSOLUTE_URL_PREFIX.test(candidate)) return index;
		if (candidate.includes("@")) return next;
	}
	return index;
}

/** Check for a bare service hostname that has no path component. */
function isBareUrlHost(value: string): boolean {
	const host = value.replace(/[)\]}>'\",]+$/, "");
	if (host === "" || /[/?#\\\s@]/.test(host)) return false;
	const url = parseUrl(`http://${host}`);
	if (url === undefined || url.pathname !== "/" || url.search || url.hash) {
		return false;
	}
	return (
		url.hostname === "localhost" ||
		url.hostname.split(".").length >= 3 ||
		/^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname)
	);
}

/**
 * Redact the credentials a URL-valued setting can embed: the userinfo
 * (`https://user:pass@host`) and the values of credential-named query and
 * fragment parameters (`?token=…`, `?api_key=…`, `?X-Amz-Signature=…`,
 * `#access_token=…`). Scheme, host, port, path, and the other parameters
 * stay visible so operators can still diagnose the configuration. Strings
 * are also scanned for credential-shaped parameters without an absolute
 * URL, while values without any credential-bearing component stay unchanged.
 */
export function redactUrlCredentials(value: string): string {
	const withSpacedValues = redactSpacedCredentialParameterValues(value);
	const tokens = withSpacedValues.split(/(\s+)/);
	let redactedAny = withSpacedValues !== value;
	for (let index = 0; index < tokens.length; index += 2) {
		let scanOffset = 0;
		while (true) {
			const token = tokens[index] ?? "";
			const match = findAbsoluteUrlPrefix(token, scanOffset);
			if (match === undefined) break;
			const nextMatch = findAbsoluteUrlPrefix(
				token,
				match.index + match.prefix.length,
			);
			const outerUserinfoEnd = userinfoEnd(
				match.prefix,
				token.slice(match.index + match.prefix.length),
			);
			const nextMatchIsInsideUserinfo =
				nextMatch !== undefined &&
				outerUserinfoEnd > 0 &&
				nextMatch.index <
					match.index + match.prefix.length + outerUserinfoEnd;
			const candidateEnd =
				nextMatchIsInsideUserinfo || nextMatch === undefined
					? token.length
					: nextMatch.index;
			const candidateToken = token.slice(match.index, candidateEnd);
			const candidateTokens = tokens.slice(index);
			candidateTokens[0] = candidateToken;
			const end = spacedUserinfoEnd(candidateTokens, 0, match.prefix);
			const url = candidateTokens.slice(0, end + 1).join("");
			const redacted = redactAbsoluteUrl(
				match.prefix,
				url.slice(match.prefix.length),
			);
			const suffix = token.slice(candidateEnd);
			tokens.splice(
				index,
				end + 1,
				`${token.slice(0, match.index)}${redacted}${suffix}`,
			);
			if (redacted !== url) redactedAny = true;
			scanOffset = match.index + redacted.length;
		}
	}
	return redactedAny ? tokens.join("") : value;
}

/**
 * Recursively replace credential-bearing fields. Arrays are walked so the
 * per-entry credentials of the SMTP pool, messengers, and bounce mailboxes
 * are covered. Every other string passes through `redactUrlCredentials`,
 * so URL-valued settings (`app.root_url`, messenger `root_url`s, the S3 and
 * OIDC endpoints, trusted redirect URLs) and an SMTP URL pasted into a
 * `host` keep their shape without their embedded credentials.
 */
export function redactSettingsCredentials(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(redactSettingsCredentials);
	}
	if (value !== null && typeof value === "object") {
		const source = value as Record<string, unknown>;
		const result: Record<string, unknown> = Object.create(null);
		for (const [key, entry] of Object.entries(source)) {
			// Assign through defineProperty so a hostile "__proto__" key
			// cannot poison the result object's prototype.
			Object.defineProperty(result, key, {
				value: isCredentialFieldName(key)
					? SETTINGS_REDACTED_VALUE
					: redactSettingsCredentials(entry),
				enumerable: true,
				writable: true,
				configurable: true,
			});
		}
		return result;
	}
	if (typeof value === "string") {
		return redactUrlCredentials(value);
	}
	return value;
}

/**
 * Read the installation settings with every credential-bearing field
 * redacted before the document leaves the executor. No shared surface
 * can persist or leak the raw SMTP/S3/OIDC credentials.
 */
export async function readSettings({
	client,
}: SettingsOperationContext): Promise<SettingsDocument> {
	const response = await client.settings.get();
	const document = unwrapResourceResponse(
		response,
		"Failed to read installation settings",
	);
	return {
		settings: redactSettingsCredentials(document) as Record<
			string,
			unknown
		>,
	};
}

export const getSettingsOperation = defineOperation({
	id: "settings.get",
	title: "Read installation settings (redacted)",
	description:
		"Read the Listmonk installation settings with every credential-bearing field (passwords, secrets, API keys, tokens, and auth usernames) and every credential embedded in a URL value (userinfo and secret query or fragment parameters) recursively replaced by [redacted].",
	inputSchema: z.object({}),
	outputSchema: settingsGetOutputSchema,
	safety: readResourceSafety,
	mcp: {
		name: "listmonk_get_settings",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindSettingsGetOperationSpec(),
	execute: readSettings,
});

export async function invokeGetSettingsOperation(
	context: SettingsOperationContext,
	input: unknown,
): Promise<SettingsDocument> {
	parseOperationInput(getSettingsOperation.inputSchema, input);
	let output: SettingsDocument;
	try {
		output = await readSettings(context);
	} catch (error) {
		throw normalizeOperationExecutionError(getSettingsOperation.id, error);
	}
	return parseOperationOutput(
		getSettingsOperation.id,
		getSettingsOperation.outputSchema,
		output,
	);
}

const SMTP_AUTH_PROTOCOLS = ["none", "plain", "cram-md5", "login"] as const;
const SMTP_TLS_TYPES = ["none", "STARTTLS", "TLS", "SSL"] as const;

const smtpServerSchema = z.object({
	name: z.string().optional(),
	host: z.string().min(1),
	port: z.number().min(1).max(65535),
	hello_hostname: z.string().optional(),
	auth_protocol: z.enum(SMTP_AUTH_PROTOCOLS).optional(),
	username: z.string().optional(),
	// Accepted for credential verification only; never persisted or
	// echoed by this operation and never written into the audit store.
	password: z.string().optional(),
	tls_type: z.enum(SMTP_TLS_TYPES).optional(),
	tls_skip_verify: z.boolean().optional(),
	max_conns: z.number().positive().optional(),
	max_msg_retries: z.number().nonnegative().optional(),
	msg_retry_delay: z.string().optional(),
	idle_timeout: z.string().optional(),
	wait_timeout: z.string().optional(),
	email_headers: z.array(z.record(z.string(), z.string())).optional(),
});

// Lowercase only the domain (the case-insensitive part): RFC 5321
// permits a case-sensitive local part, so blanket lowercasing could
// misroute the test message on systems that honor it.
const testRecipientEmailSchema = z
	.string()
	.trim()
	.min(1)
	.max(254)
	.pipe(z.email())
	.transform((value) => {
		const at = value.lastIndexOf("@");
		return `${value.slice(0, at)}${value.slice(at).toLowerCase()}`;
	});

const testSmtpInputSchema = z.object({
	email: testRecipientEmailSchema,
	server: smtpServerSchema,
});

const testSmtpOutputSchema = z.object({
	sent: z.boolean(),
	logs: z.array(z.string()),
});

export type SettingsTestSmtpOutput = z.output<typeof testSmtpOutputSchema>;

/**
 * Deliver a real test message through one candidate SMTP server
 * configuration. The observed 6.2 endpoint takes the server fields and
 * the recipient `email` flattened into one JSON body and answers with
 * the server log-buffer lines; the shared contract pins `sent` and
 * passes the lines through. Every run sends a real message, so the
 * retry classification stays honestly unsafe.
 */
export async function sendSmtpTest(
	{ client }: SettingsOperationContext,
	input: z.output<typeof testSmtpInputSchema>,
): Promise<SettingsTestSmtpOutput> {
	const { server, email } = input;
	const response = await client.settings.testSmtp({
		body: {
			...server,
			email,
		},
	});
	const logs = unwrapResourceResponse(response, "Failed to test SMTP settings");
	// The generated client types the response as a bare boolean while the
	// observed endpoint answers with the log-buffer lines; validate the
	// observed shape explicitly so a mismatch fails loudly instead of
	// degrading to an unqualified success with zero lines.
	const parsedLogs = z.array(z.string()).safeParse(logs);
	if (!parsedLogs.success) {
		throw new ResourceResponseError(
			"Failed to test SMTP settings: unexpected response payload",
			{ status: response.response?.status },
		);
	}
	return {
		sent: true,
		logs: parsedLogs.data,
	};
}

export const testSmtpOperation = defineOperation({
	id: "settings.test-smtp",
	title: "Send an SMTP configuration test message",
	description:
		"Deliver a real test message through one candidate SMTP server configuration to a single recipient, returning the server log lines captured around the attempt.",
	inputSchema: testSmtpInputSchema,
	outputSchema: testSmtpOutputSchema,
	safety: createResourceSafety,
	mcp: {
		name: "listmonk_test_smtp",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindSettingsTestSmtpOperationSpec(),
	execute: sendSmtpTest,
});

export async function invokeTestSmtpOperation(
	context: SettingsOperationContext,
	input: unknown,
): Promise<SettingsTestSmtpOutput> {
	const parsedInput = parseOperationInput(testSmtpOperation.inputSchema, input);
	let output: SettingsTestSmtpOutput;
	try {
		output = await sendSmtpTest(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(testSmtpOperation.id, error);
	}
	return parseOperationOutput(
		testSmtpOperation.id,
		testSmtpOperation.outputSchema,
		output,
	);
}

export const settingsOperations = [
	getSettingsOperation,
	testSmtpOperation,
] as const;

export const settingsOperationCatalog = defineOperationCatalog({
	id: "settings",
	title: "Settings",
	operations: settingsOperations,
	specMigrationExemptions: [],
});

export type SettingsOperation = (typeof settingsOperations)[number];

const settingsOperationsByMcpName = new Map<string, SettingsOperation>(
	settingsOperations.map((operation) => [operation.mcp.name, operation]),
);

export function getSettingsOperationByMcpName(
	name: string,
): SettingsOperation | undefined {
	return settingsOperationsByMcpName.get(name);
}

export interface SettingsOperationInvocation {
	operation: SettingsOperation;
	output: Record<string, unknown>;
}

export async function invokeSettingsOperationByMcpName(
	context: SettingsOperationContext,
	name: string,
	input: unknown,
): Promise<SettingsOperationInvocation | undefined> {
	switch (name) {
		case getSettingsOperation.mcp.name:
			return {
				operation: getSettingsOperation,
				output: await invokeGetSettingsOperation(context, input),
			};
		case testSmtpOperation.mcp.name:
			return {
				operation: testSmtpOperation,
				output: await invokeTestSmtpOperation(context, input),
			};
		default:
			return undefined;
	}
}
