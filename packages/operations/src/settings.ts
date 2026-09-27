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
 * A value that begins with an absolute URL: optional leading whitespace,
 * then an RFC 3986 scheme and `//` (or the `\\` WHATWG parsers accept for
 * special schemes), up to the first whitespace. Requiring the authority
 * keeps `mailto:` addresses, hostnames, email addresses, and CSS rules out,
 * and stopping at whitespace keeps any text after the URL verbatim.
 */
const LEADING_ABSOLUTE_URL = /^(\s*)([a-z][a-z0-9+.-]*:[\\/]{2})(\S*)/i;

function decodeQueryParameterName(encodedName: string): string {
	try {
		return decodeURIComponent(encodedName.replace(/\+/g, " "));
	} catch {
		return encodedName;
	}
}

function isCredentialQueryParameter(encodedName: string): boolean {
	const name = decodeQueryParameterName(encodedName).toLowerCase();
	if (isCredentialFieldName(name)) return true;
	return name
		.split(/[^a-z0-9]+/)
		.some(
			(token) =>
				token.endsWith("key") || URL_CREDENTIAL_PARAMETER_TOKENS.has(token),
		);
}

/**
 * Replace the value of every credential-named parameter in a `?`-prefixed
 * query. Both `&` and the legacy `;` separator split parameters, and the
 * original text of every other parameter is kept.
 */
function redactCredentialQuery(query: string): string {
	if (query.length <= 1) return query;
	const parts = query.slice(1).split(/([&;])/);
	let redacted = false;
	for (let index = 0; index < parts.length; index += 2) {
		const parameter = parts[index] ?? "";
		const separator = parameter.indexOf("=");
		if (separator <= 0 || separator === parameter.length - 1) continue;
		if (!isCredentialQueryParameter(parameter.slice(0, separator))) continue;
		parts[index] = `${parameter.slice(0, separator + 1)}${SETTINGS_REDACTED_VALUE}`;
		redacted = true;
	}
	return redacted ? `?${parts.join("")}` : query;
}

/**
 * Fallback for a URL the WHATWG parser rejects, such as one with a mistyped
 * port or an unencoded "/" in its password. Listmonk stores such values
 * as-is, so everything between "//" and the last "@" is treated as
 * userinfo: a broken URL may lose some of its visible host, but never leaks
 * its credentials.
 */
function redactUnparsedUrlCredentials(prefix: string, rest: string): string {
	const at = rest.lastIndexOf("@");
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
	return `${prefix}${userinfo}${path}${redactCredentialQuery(query)}${fragment}`;
}

function redactAbsoluteUrl(prefix: string, rest: string): string {
	let url: URL;
	try {
		url = new URL(`${prefix}${rest}`);
	} catch {
		return redactUnparsedUrlCredentials(prefix, rest);
	}
	const hasUserinfo = url.username !== "" || url.password !== "";
	const search = redactCredentialQuery(url.search);
	if (!hasUserinfo && search === url.search) return `${prefix}${rest}`;
	const userinfo = hasUserinfo ? `${SETTINGS_REDACTED_VALUE}@` : "";
	return `${url.protocol}//${userinfo}${url.host}${url.pathname}${search}${url.hash}`;
}

/**
 * Redact the credentials a URL-valued setting can embed: the userinfo
 * (`https://user:pass@host`) and the values of credential-named query
 * parameters (`?token=…`, `?api_key=…`, `?X-Amz-Signature=…`). Scheme,
 * host, port, path, the other parameters, and the fragment stay visible so
 * operators can still diagnose the configuration. A value that does not
 * begin with an absolute URL, or whose URL has nothing to redact, is
 * returned unchanged.
 */
export function redactUrlCredentials(value: string): string {
	const match = LEADING_ABSOLUTE_URL.exec(value);
	if (match === null) return value;
	const [leadingUrl, leading = "", prefix = "", rest = ""] = match;
	const redacted = redactAbsoluteUrl(prefix, rest);
	if (redacted === `${prefix}${rest}`) return value;
	return `${leading}${redacted}${value.slice(leadingUrl.length)}`;
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
		"Read the Listmonk installation settings with every credential-bearing field (passwords, secrets, API keys, tokens, and auth usernames) and every credential embedded in a URL value (userinfo and secret query parameters) recursively replaced by [redacted].",
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
