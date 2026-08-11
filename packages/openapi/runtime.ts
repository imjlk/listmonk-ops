import { createClient } from "./generated/client/client.gen";
import type { Client } from "./generated/client/types.gen";
import { transactWithSubscriber } from "./generated/sdk.gen";

// Local domains such as `trainer@mailpit` are intentionally supported for
// private deployments and the repository's Mailpit test environment.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/u;
const EMAIL_DOMAIN_LABEL_PATTERN =
	/^(?:[\p{L}\p{N}]|[\p{L}\p{N}][\p{L}\p{N}-]{0,61}[\p{L}\p{N}])$/u;
const UNSAFE_EMAIL_CHARACTER_PATTERN = /[\\",:;<>()[\]]/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const PRINTABLE_ASCII_PATTERN = /^[\u0020-\u007e]+$/u;
const INVISIBLE_IDENTIFIER_PATTERN = /\p{Default_Ignorable_Code_Point}/u;
const UNSAFE_URL_CHARACTER_PATTERN =
	/[%\\\u0000-\u001f\u007f-\u009f\u3002\uff0e\uff61]|\p{Default_Ignorable_Code_Point}/u;
const DEFAULT_TIMEOUT_MS = 30_000;
// Avoid the 32-bit timer overflow behavior used by Node-compatible runtimes.
const MAX_TIMEOUT_MS = 2_147_483_647;
const MAX_RECIPIENT_BYTES = 254;
const MAX_FROM_EMAIL_BYTES = 512;
const MAX_MESSENGER_BYTES = 128;
const MAX_SUBJECT_BYTES = 256;
const MAX_ACKNOWLEDGEMENT_BYTES = 64 * 1024;
const MAX_TRANSACTIONAL_BODY_BYTES = 64 * 1024;
const MAX_TRANSACTIONAL_DATA_DEPTH = 32;
const MAX_TRANSACTIONAL_DATA_NODES = 2_048;
const MAX_TRANSACTIONAL_TEXT_UNITS = 64 * 1024;
const TRANSACTIONAL_REQUEST_FAILED_MESSAGE = "Listmonk request failed.";
const UTF8_ENCODER = new TextEncoder();

declare const runtimeClientBrand: unique symbol;

export interface ListmonkRuntimeClient {
	readonly [runtimeClientBrand]: true;
}

interface RegisteredRuntimeClientConfiguration {
	readonly apiBaseUrl: string;
	readonly authorization: string;
	readonly client: Client;
	readonly fetch: typeof globalThis.fetch;
}

const runtimeClientConfigurations = new WeakMap<
	ListmonkRuntimeClient,
	RegisteredRuntimeClientConfiguration
>();

export type ListmonkRuntimeErrorCode =
	| "aborted"
	| "delivery_rejected"
	| "invalid_configuration"
	| "invalid_message"
	| "request_failed"
	| "timed_out";

export type ListmonkRuntimeFailureReason =
	| "aborted"
	| "client_exception"
	| "http_error"
	| "invalid_acknowledgement"
	| "missing_response"
	| "network_error"
	| "negative_acknowledgement"
	| "response_parse_failed"
	| "timed_out";

export class ListmonkRuntimeError extends Error {
	public readonly code: ListmonkRuntimeErrorCode;
	public readonly reason: ListmonkRuntimeFailureReason | undefined;
	public readonly status: number | undefined;

	public constructor(
		code: ListmonkRuntimeErrorCode,
		message: string,
		options: {
			status?: number;
			reason?: ListmonkRuntimeFailureReason;
		} = {},
	) {
		super(message);
		this.name = "ListmonkRuntimeError";
		this.code = code;
		this.reason = options.reason;
		this.status = options.status;
	}
}

export interface ListmonkRuntimeClientOptions {
	/** Listmonk origin or mount path. `/api` is appended when absent. */
	baseUrl: string;
	username: string;
	accessToken: string;
	fetch?: typeof globalThis.fetch;
}

export interface ExternalTransactionalEmailInput {
	client: ListmonkRuntimeClient;
	templateId: number;
	recipient: string;
	/** Optional Listmonk From override, as an address or `Display Name <address>`. */
	fromEmail?: string;
	/** Optional exact Listmonk messenger name. */
	messenger?: string;
	subject?: string;
	data?: Record<string, unknown>;
	signal?: AbortSignal;
	/** Positive timeout in milliseconds. Defaults to 30 seconds. */
	timeoutMs?: number;
}

export interface ExternalTransactionalEmailResult {
	readonly sent: true;
	readonly status: number;
}

/**
 * Normalizes a Listmonk origin or mount path to its API base URL.
 *
 * Credentials, query strings, and fragments are rejected so a caller cannot
 * accidentally place secrets or request-specific state in every SDK URL.
 */
export function normalizeListmonkApiBaseUrl(baseUrl: string): string {
	const value = exactNonEmpty(
		baseUrl,
		"Listmonk base URL",
		"invalid_configuration",
	);
	const authority = /^[a-z][a-z\d+.-]*:\/\/([^/?#]+)/iu.exec(value)?.[1];
	if (authority === undefined) {
		throw new ListmonkRuntimeError(
			"invalid_configuration",
			"Listmonk base URL must use a standard absolute URL authority.",
		);
	}
	if (
		!value.isWellFormed() ||
		UNSAFE_URL_CHARACTER_PATTERN.test(value) ||
		/(?:^|\/)\.{1,2}(?:\/|[?#]|$)/u.test(value)
	) {
		throw new ListmonkRuntimeError(
			"invalid_configuration",
			"Listmonk base URL contains unsupported characters or path segments.",
		);
	}
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		// Do not chain the URL parser error: its message may repeat an input
		// that accidentally contained credentials.
		throw new ListmonkRuntimeError(
			"invalid_configuration",
			"Listmonk base URL must be an absolute HTTPS URL.",
		);
	}
	if (parsed.protocol !== "https:") {
		throw new ListmonkRuntimeError(
			"invalid_configuration",
			"Listmonk base URL must use HTTPS for token-authenticated traffic.",
		);
	}
	if (
		parsed.username !== "" ||
		parsed.password !== "" ||
		parsed.search !== "" ||
		parsed.hash !== ""
	) {
		throw new ListmonkRuntimeError(
			"invalid_configuration",
			"Listmonk base URL must not include credentials, a query, or a fragment.",
		);
	}

	const path = parsed.pathname.replace(/\/+$/u, "");
	parsed.pathname = path.endsWith("/api") ? path : `${path}/api`;
	return parsed.toString().replace(/\/$/u, "");
}

/** Creates Listmonk's API-token authorization value without logging secrets. */
export function createListmonkTokenAuthorization(
	username: string,
	accessToken: string,
): string {
	const safeUsername = exactNonEmpty(
		username,
		"Listmonk username",
		"invalid_configuration",
	);
	const safeToken = exactNonEmpty(
		accessToken,
		"Listmonk access token",
		"invalid_configuration",
	);
	if (safeUsername.includes(":")) {
		throw new ListmonkRuntimeError(
			"invalid_configuration",
			"Listmonk username must not contain a colon.",
		);
	}
	if (
		CONTROL_CHARACTER_PATTERN.test(safeUsername) ||
		CONTROL_CHARACTER_PATTERN.test(safeToken) ||
		INVISIBLE_IDENTIFIER_PATTERN.test(safeUsername) ||
		INVISIBLE_IDENTIFIER_PATTERN.test(safeToken)
	) {
		throw new ListmonkRuntimeError(
			"invalid_configuration",
			"Listmonk credentials must not contain control or invisible formatting characters.",
		);
	}
	if (
		!PRINTABLE_ASCII_PATTERN.test(safeUsername) ||
		!PRINTABLE_ASCII_PATTERN.test(safeToken)
	) {
		throw new ListmonkRuntimeError(
			"invalid_configuration",
			"Listmonk credentials must contain only printable ASCII characters.",
		);
	}
	return `token ${safeUsername}:${safeToken}`;
}

/**
 * Creates an opaque handle around the minimal generated SDK client for
 * Fetch-compatible runtimes. This entrypoint does not import the Node/Bun
 * enhanced client or file stores.
 */
export function createListmonkRuntimeClient(
	options: ListmonkRuntimeClientOptions,
): ListmonkRuntimeClient {
	if (typeof options !== "object" || options === null) {
		throw new ListmonkRuntimeError(
			"invalid_configuration",
			"Runtime client options are required.",
		);
	}
	const clientOptions = snapshotRuntimeClientOptions(options);
	const apiBaseUrl = normalizeListmonkApiBaseUrl(clientOptions.baseUrl);
	const authorization = createListmonkTokenAuthorization(
		clientOptions.username,
		clientOptions.accessToken,
	);
	const runtimeFetch = clientOptions.fetch ?? globalThis.fetch;
	if (typeof runtimeFetch !== "function") {
		throw new ListmonkRuntimeError(
			"invalid_configuration",
			"Runtime client requires Fetch.",
		);
	}
	let client: Client;
	try {
		client = createClient({
			baseUrl: apiBaseUrl,
			headers: {
				Authorization: authorization,
			},
			fetch: runtimeFetch,
		});
	} catch {
		throw new ListmonkRuntimeError(
			"invalid_configuration",
			"Runtime client initialization failed.",
		);
	}
	const runtimeHandle = Object.freeze({}) as ListmonkRuntimeClient;
	runtimeClientConfigurations.set(runtimeHandle, {
		apiBaseUrl,
		authorization,
		client,
		fetch: runtimeFetch,
	});
	return runtimeHandle;
}

/**
 * Sends one transactional email without creating or updating a subscriber.
 *
 * The helper fails closed unless Listmonk returns an explicit `data: true`
 * acknowledgement. Remote response bodies and recipient data are never copied
 * into the stable error surface.
 *
 * This operation is non-idempotent: a retry after a transient failure may
 * send a duplicate email. Callers own retry and idempotency decisions. An
 * `aborted` or `timed_out` result is also ambiguous and does not prove the
 * message was unsent. Requests time out after 30 seconds unless overridden.
 */
export async function sendExternalTransactionalEmail(
	input: ExternalTransactionalEmailInput,
): Promise<ExternalTransactionalEmailResult> {
	if (typeof input !== "object" || input === null) {
		throw new ListmonkRuntimeError(
			"invalid_message",
			"Transactional input is required.",
		);
	}
	const message = snapshotTransactionalInput(input);
	const {
		client,
		data: inputData,
		fromEmail: inputFromEmail,
		messenger: inputMessenger,
		recipient: inputRecipient,
		signal,
		subject: inputSubject,
		templateId,
		timeoutMs: inputTimeoutMs,
	} = message;
	if (signal !== undefined && !isAbortSignalLike(signal)) {
		throw new ListmonkRuntimeError(
			"invalid_message",
			"Transactional signal must be an AbortSignal.",
		);
	}
	if (signalIsAborted(signal)) {
		throw transactionalAbortedError();
	}
	const runtimeConfiguration = resolveRuntimeClientConfiguration(client);
	const timeoutMs = inputTimeoutMs ?? DEFAULT_TIMEOUT_MS;
	if (
		!Number.isSafeInteger(timeoutMs) ||
		timeoutMs <= 0 ||
		timeoutMs > MAX_TIMEOUT_MS
	) {
		throw new ListmonkRuntimeError(
			"invalid_message",
			`Transactional timeout must be an integer between 1 and ${MAX_TIMEOUT_MS} milliseconds.`,
		);
	}
	if (!Number.isSafeInteger(templateId) || templateId <= 0) {
		throw new ListmonkRuntimeError(
			"invalid_message",
			"Transactional template ID must be a positive safe integer.",
		);
	}
	const recipient = exactNonEmpty(
		inputRecipient,
		"Transactional recipient",
		"invalid_message",
	);
	if (!isValidEmailAddress(recipient)) {
		throw new ListmonkRuntimeError(
			"invalid_message",
			"Transactional recipient must be one well-formed email address.",
		);
	}
	const fromEmail = optionalFromEmailValue(inputFromEmail);
	const messenger = optionalMessengerValue(inputMessenger);
	const subject = optionalSubjectValue(inputSubject, "Transactional subject");
	const data = snapshotTransactionalData(inputData);
	const abortContext = createTransactionalAbortContext(signal, timeoutMs);

	const result = await (async () => {
		try {
			const preflightAbortError = classifyTransactionalAbortError(
				undefined,
				abortContext,
				timeoutMs,
			);
			if (preflightAbortError !== undefined) throw preflightAbortError;
			return await Promise.race([
				transactWithSubscriber({
					baseUrl: runtimeConfiguration.apiBaseUrl,
					bodySerializer: serializeTransactionalBody,
					client: runtimeConfiguration.client,
					fetch: normalizeRuntimeResponseBody(runtimeConfiguration.fetch),
					headers: {
						Authorization: runtimeConfiguration.authorization,
					},
					// Redirects must never replay this non-idempotent body outside the
					// validated Listmonk origin. Parse as text so malformed successful
					// responses can be projected without losing their HTTP status.
					redirect: "error",
					parseAs: "text",
					requestValidator: undefined,
					responseStyle: "fields",
					responseTransformer: undefined,
					responseValidator: undefined,
					signal: abortContext.signal,
					throwOnError: false,
					body: {
						template_id: templateId,
						subscriber_mode: "external",
						subscriber_emails: [recipient],
						...(fromEmail === undefined ? {} : { from_email: fromEmail }),
						...(messenger === undefined ? {} : { messenger }),
						...(subject === undefined ? {} : { subject }),
						...(data === undefined ? {} : { data }),
					},
				}),
				abortContext.interruption,
			]);
		} catch (error: unknown) {
			if (error instanceof ListmonkRuntimeError) throw error;
			const abortError = classifyTransactionalAbortError(
				error,
				abortContext,
				timeoutMs,
			);
			if (abortError !== undefined) throw abortError;
			// Generated response handling and interceptors can throw values that
			// include a remote body. Do not copy or chain them into the stable error.
			throw new ListmonkRuntimeError(
				"request_failed",
				TRANSACTIONAL_REQUEST_FAILED_MESSAGE,
				{ reason: "client_exception" },
			);
		} finally {
			abortContext.cleanup();
		}
	})();
	const completedAbortError = classifyTransactionalAbortError(
		undefined,
		abortContext,
		timeoutMs,
	);
	if (completedAbortError !== undefined) throw completedAbortError;
	const status = result.response?.status;
	if (result.error !== undefined) {
		if (status === undefined) {
			const abortError = classifyTransactionalAbortError(
				result.error,
				abortContext,
				timeoutMs,
			);
			if (abortError !== undefined) throw abortError;
		}
		throw new ListmonkRuntimeError(
			"request_failed",
			TRANSACTIONAL_REQUEST_FAILED_MESSAGE,
			{
				...(status === undefined ? {} : { status }),
				reason: status === undefined ? "network_error" : "http_error",
			},
		);
	}
	if (status === undefined) {
		throw new ListmonkRuntimeError(
			"request_failed",
			TRANSACTIONAL_REQUEST_FAILED_MESSAGE,
			{ reason: "missing_response" },
		);
	}
	const acknowledgement = parseTransactionalAcknowledgement(
		result.data,
		status,
	);
	if (typeof acknowledgement !== "boolean") {
		throw new ListmonkRuntimeError(
			"request_failed",
			"Listmonk response had no valid acknowledgement.",
			{ status, reason: "invalid_acknowledgement" },
		);
	}
	if (!acknowledgement) {
		throw new ListmonkRuntimeError(
			"delivery_rejected",
			"Listmonk rejected the transactional message.",
			{ status, reason: "negative_acknowledgement" },
		);
	}
	return { sent: true, status };
}

function parseTransactionalAcknowledgement(
	responseData: unknown,
	status: number,
): unknown {
	let parsed: unknown;
	try {
		if (typeof responseData !== "string") throw new TypeError();
		parsed = responseData.length === 0 ? {} : JSON.parse(responseData);
	} catch {
		throw new ListmonkRuntimeError(
			"request_failed",
			TRANSACTIONAL_REQUEST_FAILED_MESSAGE,
			{ status, reason: "response_parse_failed" },
		);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return undefined;
	}
	return (parsed as { data?: unknown }).data;
}

function resolveRuntimeClientConfiguration(
	client: ListmonkRuntimeClient,
): RegisteredRuntimeClientConfiguration {
	const registered = runtimeClientConfigurations.get(client);
	if (registered === undefined) {
		throw new ListmonkRuntimeError(
			"invalid_configuration",
			"Transactional email requires a runtime client.",
		);
	}
	return registered;
}

function transactionalAbortedError(): ListmonkRuntimeError {
	return new ListmonkRuntimeError(
		"aborted",
		"Request was aborted; delivery is unknown.",
		{ reason: "aborted" },
	);
}

function transactionalTimeoutError(timeoutMs: number): ListmonkRuntimeError {
	return new ListmonkRuntimeError(
		"timed_out",
		`Request timed out after ${timeoutMs} ms; delivery is unknown.`,
		{ reason: "timed_out" },
	);
}

type TransactionalAbortKind = "caller" | "timeout";

interface TransactionalAbortContext {
	readonly signal: AbortSignal;
	readonly kind: () => TransactionalAbortKind | undefined;
	readonly interruption: Promise<never>;
	readonly cleanup: () => void;
}

function classifyTransactionalAbortError(
	error: unknown,
	context: TransactionalAbortContext,
	timeoutMs: number,
): ListmonkRuntimeError | undefined {
	const kind = context.kind();
	if (kind === "timeout") {
		return transactionalTimeoutError(timeoutMs);
	}
	if (kind === "caller") {
		return transactionalAbortedError();
	}
	const name = safeErrorName(error);
	if (name === "TimeoutError") return transactionalTimeoutError(timeoutMs);
	if (name === "AbortError") return transactionalAbortedError();
	return undefined;
}

function normalizeRuntimeResponseBody(
	fetchImplementation: typeof globalThis.fetch,
): typeof globalThis.fetch {
	return (async (request, init) => {
		const response = await fetchImplementation(request, {
			...init,
			redirect: "error",
		});
		const requestUrl = request instanceof Request
			? request.url
			: String(request);
		if (
			response.redirected ||
			(response.url && response.url !== requestUrl)
		) {
			void response.body?.cancel().catch(() => undefined);
			throw new TypeError();
		}
		if (!response.ok) {
			void response.body?.cancel().catch(() => undefined);
			return new Response(null, { status: response.status });
		}
		if (response.status === 204 || response.status === 205) {
			return new Response(null, { status: response.status });
		}
		try {
			const body = await readBoundedAcknowledgementBody(
				response,
				request instanceof Request ? request.signal : undefined,
			);
			return new Response(body ?? "{", { status: response.status });
		} catch {
			if (request instanceof Request && request.signal.aborted) {
				throw abortReason(request.signal);
			}
			// A local malformed sentinel lets acknowledgement parsing preserve the
			// accepted-but-unreadable HTTP status without exposing a remote body.
			return new Response("{", { status: response.status });
		}
	}) as typeof globalThis.fetch;
}

async function readBoundedAcknowledgementBody(
	response: Response,
	signal: AbortSignal | undefined,
): Promise<string | undefined> {
	if (response.body === null) return "";

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let removeAbortListener: (() => void) | undefined;
	const interruption =
		signal === undefined
			? undefined
			: new Promise<never>((_resolve, reject) => {
					const onAbort = () => reject(abortReason(signal));
					if (signal.aborted) {
						onAbort();
						return;
					}
					signal.addEventListener("abort", onAbort, { once: true });
					removeAbortListener = () =>
						signal.removeEventListener("abort", onAbort);
				});
	let byteLength = 0;
	let text = "";
	let drained = false;
	try {
		while (true) {
			const pendingRead = reader.read();
			const chunk =
				interruption === undefined
					? await pendingRead
					: await Promise.race([pendingRead, interruption]);
			if (chunk.done) {
				drained = true;
				return text + decoder.decode();
			}
			byteLength += chunk.value.byteLength;
			if (byteLength > MAX_ACKNOWLEDGEMENT_BYTES) return undefined;
			text += decoder.decode(chunk.value, { stream: true });
		}
	} finally {
		try {
			removeAbortListener?.();
		} catch {
			// Cleanup must not replace the bounded acknowledgement outcome.
		}
		if (!drained) {
			try {
				void reader
					.cancel()
					.catch(() => undefined)
					.then(() => releaseReaderLock(reader));
			} catch {
				// Cleanup must not replace an unreadable acknowledgement outcome.
			}
		}
		releaseReaderLock(reader);
	}
}

function releaseReaderLock(reader: ReadableStreamDefaultReader<Uint8Array>): void {
	try {
		reader.releaseLock();
	} catch {
		// A pending or non-standard stream must not escape the error surface.
	}
}

function createTransactionalAbortContext(
	callerSignal: AbortSignal | undefined,
	timeoutMs: number,
): TransactionalAbortContext {
	if (signalIsAborted(callerSignal)) throw transactionalAbortedError();
	const controller = new AbortController();
	let abortKind: TransactionalAbortKind | undefined;
	let rejectInterruption: (reason: unknown) => void = () => undefined;
	const interruption = new Promise<never>((_resolve, reject) => {
		rejectInterruption = reject;
	});
	void interruption.catch(() => undefined);
	const abortOnce = (kind: TransactionalAbortKind, reason: unknown) => {
		if (abortKind !== undefined) return;
		abortKind = kind;
		controller.abort(reason);
		rejectInterruption(reason);
	};
	const timeoutHandle = setTimeout(() => {
		abortOnce(
			"timeout",
			new DOMException("Listmonk request timed out", "TimeoutError"),
		);
	}, timeoutMs);
	let removeCallerAbortListener: (() => void) | undefined;

	try {
		if (callerSignal !== undefined) {
			const onCallerAbort = () => {
				abortOnce("caller", abortReason(callerSignal));
			};
			callerSignal.addEventListener("abort", onCallerAbort, { once: true });
			removeCallerAbortListener = () => {
				callerSignal.removeEventListener("abort", onCallerAbort);
			};
		}
	} catch {
		clearTimeout(timeoutHandle);
		throw new ListmonkRuntimeError(
			"invalid_message",
			"Transactional signal could not be observed.",
		);
	}
	return {
		signal: controller.signal,
		kind: () => abortKind,
		interruption,
		cleanup: () => {
			clearTimeout(timeoutHandle);
			try {
				removeCallerAbortListener?.();
			} catch {
				// Cleanup must not replace the outcome of a non-idempotent send.
			}
		},
	};
}

function abortReason(signal: AbortSignal): unknown {
	try {
		return signal.reason ?? new DOMException("Request aborted", "AbortError");
	} catch {
		return new DOMException("Request aborted", "AbortError");
	}
}

function signalIsAborted(signal: AbortSignal | undefined): boolean {
	try {
		return signal?.aborted === true;
	} catch {
		throw new ListmonkRuntimeError(
			"invalid_message",
			"Transactional signal could not be read.",
		);
	}
}

function safeErrorName(error: unknown): unknown {
	if (typeof error !== "object" || error === null) return undefined;
	try {
		return Reflect.get(error, "name");
	} catch {
		return undefined;
	}
}

function isValidEmailAddress(email: string): boolean {
	return (
		email.isWellFormed() &&
		utf8ByteLength(email) <= MAX_RECIPIENT_BYTES &&
		EMAIL_PATTERN.test(email) &&
		hasValidEmailAddressParts(email) &&
		!UNSAFE_EMAIL_CHARACTER_PATTERN.test(email) &&
		!CONTROL_CHARACTER_PATTERN.test(email) &&
		!INVISIBLE_IDENTIFIER_PATTERN.test(email)
	);
}

function hasValidEmailAddressParts(email: string): boolean {
	const separatorIndex = email.lastIndexOf("@");
	if (separatorIndex <= 0 || separatorIndex === email.length - 1) return false;
	const localPart = email.slice(0, separatorIndex);
	if (
		utf8ByteLength(localPart) > 64 ||
		localPart.startsWith(".") ||
		localPart.endsWith(".") ||
		localPart.includes("..")
	) {
		return false;
	}
	const domain = email.slice(separatorIndex + 1);
	if (
		!domain
			.split(".")
			.every((label) => EMAIL_DOMAIN_LABEL_PATTERN.test(label))
	) {
		return false;
	}
	try {
		const encodedDomain = new URL(`https://${domain}`).hostname;
		return (
			encodedDomain.length <= 253 &&
			encodedDomain.split(".").every((label) => label.length <= 63)
		);
	} catch {
		return false;
	}
}

function exactNonEmpty(
	value: unknown,
	label: string,
	code: "invalid_configuration" | "invalid_message",
): string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value !== value.trim()
	) {
		throw new ListmonkRuntimeError(
			code,
			`${label} must be non-empty and must not contain surrounding whitespace.`,
		);
	}
	return value;
}

function snapshotRuntimeClientOptions(
	options: ListmonkRuntimeClientOptions,
): ListmonkRuntimeClientOptions {
	try {
		return {
			accessToken: options.accessToken,
			baseUrl: options.baseUrl,
			fetch: options.fetch,
			username: options.username,
		};
	} catch {
		throw new ListmonkRuntimeError(
			"invalid_configuration",
			"Runtime client options could not be read.",
		);
	}
}

function snapshotTransactionalInput(
	input: ExternalTransactionalEmailInput,
): ExternalTransactionalEmailInput {
	try {
		return {
			client: input.client,
			data: input.data,
			fromEmail: input.fromEmail,
			messenger: input.messenger,
			recipient: input.recipient,
			signal: input.signal,
			subject: input.subject,
			templateId: input.templateId,
			timeoutMs: input.timeoutMs,
		};
	} catch {
		throw new ListmonkRuntimeError(
			"invalid_message",
			"Transactional fields could not be read.",
		);
	}
}

function serializeTransactionalBody(body: unknown): string {
	let serialized: unknown;
	try {
		serialized = JSON.stringify(body);
	} catch {
		throw new ListmonkRuntimeError(
			"invalid_message",
			"Transactional body must be JSON-serializable.",
		);
	}
	if (typeof serialized !== "string") {
		throw new ListmonkRuntimeError(
			"invalid_message",
			"Transactional body must serialize to JSON.",
		);
	}
	if (utf8ByteLength(serialized) > MAX_TRANSACTIONAL_BODY_BYTES) {
		throw new ListmonkRuntimeError(
			"invalid_message",
			`Transactional body must not exceed ${MAX_TRANSACTIONAL_BODY_BYTES} UTF-8 bytes.`,
		);
	}
	return serialized;
}

function utf8ByteLength(value: string): number {
	return UTF8_ENCODER.encode(value).byteLength;
}

function snapshotTransactionalData(
	data: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	validateTransactionalDataStructure(data);
	if (data === undefined) return undefined;
	let snapshot: unknown;
	try {
		snapshot = structuredClone(data);
	} catch {
		throw transactionalDataStructureError();
	}
	validateTransactionalDataStructure(snapshot as Record<string, unknown>);
	return snapshot as Record<string, unknown>;
}

function validateTransactionalDataStructure(
	data: Record<string, unknown> | undefined,
): void {
	if (
		hasToJSONHook(Object.prototype) ||
		hasToJSONHook(Array.prototype)
	) {
		throw transactionalDataStructureError();
	}
	if (data === undefined) return;
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		throw transactionalDataStructureError();
	}
	const stack: Array<{ depth: number; exit?: boolean; value: unknown }> = [
		{ depth: 0, value: data },
	];
	const ancestors = new WeakSet<object>();
	let nodes = 0;
	let textUnits = 0;
	try {
		while (stack.length > 0) {
			const current = stack.pop();
			if (current === undefined) break;
			if (current.exit === true) {
				ancestors.delete(current.value as object);
				continue;
			}
			nodes += 1;
			if (
				nodes > MAX_TRANSACTIONAL_DATA_NODES ||
				current.depth > MAX_TRANSACTIONAL_DATA_DEPTH
			) {
				throw transactionalDataStructureError();
			}
			if (typeof current.value === "string") {
				if (!current.value.isWellFormed()) {
					throw transactionalDataStructureError();
				}
				textUnits += current.value.length;
				if (textUnits > MAX_TRANSACTIONAL_TEXT_UNITS) {
					throw transactionalDataStructureError();
				}
				continue;
			}
			if (
				current.value === undefined ||
				typeof current.value === "bigint" ||
				typeof current.value === "function" ||
				typeof current.value === "symbol" ||
				(typeof current.value === "number" &&
					!Number.isFinite(current.value))
			) {
				throw transactionalDataStructureError();
			}
			if (typeof current.value !== "object" || current.value === null) {
				continue;
			}
			if (ancestors.has(current.value)) throw transactionalDataStructureError();
			ancestors.add(current.value);
			stack.push({
				depth: current.depth,
				exit: true,
				value: current.value,
			});
			const objectValue = current.value as object;
			const isArray = Array.isArray(objectValue);
			const prototype = Object.getPrototypeOf(objectValue);
			if (
				isArray
					? prototype !== Array.prototype ||
						(objectValue as Array<unknown>).length >
							MAX_TRANSACTIONAL_DATA_NODES
					: prototype !== Object.prototype && prototype !== null
			) {
				throw transactionalDataStructureError();
			}
			if (hasToJSONHook(objectValue)) {
				throw transactionalDataStructureError();
			}
			if (isArray) {
				const arrayValue = objectValue as Array<unknown>;
				if (Reflect.ownKeys(arrayValue).length !== arrayValue.length + 1) {
					throw transactionalDataStructureError();
				}
				for (let index = arrayValue.length - 1; index >= 0; index -= 1) {
					if (!Object.hasOwn(arrayValue, index)) {
						throw transactionalDataStructureError();
					}
					stack.push({
						depth: current.depth + 1,
						value: Object.getOwnPropertyDescriptor(arrayValue, index)?.value,
					});
				}
				continue;
			}
			for (const key of Reflect.ownKeys(objectValue)) {
				if (typeof key !== "string") throw transactionalDataStructureError();
				if (!key.isWellFormed()) throw transactionalDataStructureError();
				const descriptor = Object.getOwnPropertyDescriptor(objectValue, key);
				if (descriptor?.enumerable !== true) {
					throw transactionalDataStructureError();
				}
				textUnits += key.length;
				if (textUnits > MAX_TRANSACTIONAL_TEXT_UNITS) {
					throw transactionalDataStructureError();
				}
				stack.push({
					depth: current.depth + 1,
					value: descriptor.value,
				});
			}
		}
	} catch (error: unknown) {
		if (error instanceof ListmonkRuntimeError) throw error;
		throw transactionalDataStructureError();
	}
}

function hasToJSONHook(value: object): boolean {
	let current: object | null = value;
	for (
		let depth = 0;
		current !== null && depth <= MAX_TRANSACTIONAL_DATA_DEPTH;
		depth += 1
	) {
		const descriptor = Object.getOwnPropertyDescriptor(current, "toJSON");
		if (
			descriptor !== undefined &&
			(!("value" in descriptor) || typeof descriptor.value === "function")
		) {
			return true;
		}
		current = Object.getPrototypeOf(current);
	}
	return current !== null;
}

function transactionalDataStructureError(): ListmonkRuntimeError {
	return new ListmonkRuntimeError(
		"invalid_message",
		"Transactional data exceeds limits or contains unsupported values.",
	);
}

function isAbortSignalLike(signal: unknown): signal is AbortSignal {
	try {
		const candidate = signal as Partial<AbortSignal>;
		return (
			typeof signal === "object" &&
			signal !== null &&
			typeof candidate.aborted === "boolean" &&
			typeof candidate.addEventListener === "function" &&
			typeof candidate.removeEventListener === "function"
		);
	} catch {
		return false;
	}
}

function optionalFromEmailValue(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const normalized = exactNonEmpty(
		value,
		"Transactional From address",
		"invalid_message",
	);
	if (
		!normalized.isWellFormed() ||
		utf8ByteLength(normalized) > MAX_FROM_EMAIL_BYTES ||
		CONTROL_CHARACTER_PATTERN.test(normalized) ||
		INVISIBLE_IDENTIFIER_PATTERN.test(normalized)
	) {
		throw transactionalFromAddressError();
	}
	if (isValidEmailAddress(normalized)) return normalized;

	const mailboxSeparator = normalized.lastIndexOf(" <");
	if (mailboxSeparator <= 0 || !normalized.endsWith(">")) {
		throw transactionalFromAddressError();
	}
	const displayName = normalized.slice(0, mailboxSeparator);
	const address = normalized.slice(mailboxSeparator + 2, -1);
	if (!isValidFromDisplayName(displayName) || !isValidEmailAddress(address)) {
		throw transactionalFromAddressError();
	}
	return normalized;
}

function isValidFromDisplayName(value: string): boolean {
	// Accept a conservative single-mailbox display-name subset. Any edge quote
	// routes through the quoted-string grammar so partial quoting is rejected;
	// unquoted names exclude address-list/structural characters through the
	// shared unsafe pattern and exclude `@` to avoid bare-address ambiguity.
	if (value.startsWith('"') || value.endsWith('"')) {
		return /^"(?:[^"\\]|\\.)+"$/u.test(value);
	}
	return (
		value.length > 0 &&
		value === value.trim() &&
		!UNSAFE_EMAIL_CHARACTER_PATTERN.test(value) &&
		!value.includes("@")
	);
}

function transactionalFromAddressError(): ListmonkRuntimeError {
	return new ListmonkRuntimeError(
		"invalid_message",
		"Transactional From address must be one well-formed mailbox.",
	);
}

function optionalMessengerValue(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const normalized = exactNonEmpty(
		value,
		"Transactional messenger",
		"invalid_message",
	);
	if (
		!normalized.isWellFormed() ||
		utf8ByteLength(normalized) > MAX_MESSENGER_BYTES ||
		CONTROL_CHARACTER_PATTERN.test(normalized) ||
		INVISIBLE_IDENTIFIER_PATTERN.test(normalized)
	) {
		throw new ListmonkRuntimeError(
			"invalid_message",
			"Transactional messenger must be a bounded well-formed name.",
		);
	}
	return normalized;
}

function optionalSubjectValue(
	value: string | undefined,
	label: string,
): string | undefined {
	if (value === undefined) return undefined;
	const normalized = exactNonEmpty(value, label, "invalid_message");
	// Subject is RFC 5322 unstructured text: punctuation that is unsafe in an
	// addr-spec remains valid here. JSON transport plus the control-character
	// guard prevents header injection without rejecting normal subject lines.
	if (
		!normalized.isWellFormed() ||
		CONTROL_CHARACTER_PATTERN.test(normalized) ||
		INVISIBLE_IDENTIFIER_PATTERN.test(normalized)
	) {
		throw new ListmonkRuntimeError(
			"invalid_message",
			`${label} must not contain control or invisible formatting characters.`,
		);
	}
	if (utf8ByteLength(normalized) > MAX_SUBJECT_BYTES) {
		throw new ListmonkRuntimeError(
			"invalid_message",
			`${label} must not exceed ${MAX_SUBJECT_BYTES} UTF-8 bytes.`,
		);
	}
	return normalized;
}
