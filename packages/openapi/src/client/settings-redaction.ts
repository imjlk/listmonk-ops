/** Marker used when settings credentials are redacted for safe display. */
export const SETTINGS_REDACTED_VALUE = "[redacted]";

const CREDENTIAL_QUERY_NAME_SUFFIX =
	/(?:^|_)(?:key|apikey|apikeysecret|apisecret|accesskey|accesskeyid|awsaccesskeyid|secretaccesskey|awssecretaccesskey|secretkey|clientkey|clientsecret|privatekey|signingkey|sendgridkey|forwardemailkey|accesstoken|authtoken|refreshtoken|sessiontoken|access_key|access_key_id|api_key_id|secret_key_id|key_id|key_pair_id|session_id|id_token_hint|client_assertion|assertion_token|saml_assertion|assertion|auth|authorization|credential|credentials|hmac|jwt|login|pass|password|passphrase|passwd|pwd|secret|sessid|session|sessionid|sig|signature|token|user|username)$/;

/** Match whole credential parameter names while preserving unrelated metadata. */
export function isSettingsCredentialQueryParameter(
	encodedName: string,
): boolean {
	let decodedName = encodedName;
	try {
		decodedName = decodeURIComponent(encodedName.replace(/\+/g, " "));
	} catch {
		// Keep malformed parameter names visible to the exact token matcher.
	}
	const normalizedName = decodedName
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_|_$/g, "");
	return CREDENTIAL_QUERY_NAME_SUFFIX.test(normalizedName);
}

/** The marker as the redactor writes it into percent-encoded nested URLs. */
const ENCODED_REDACTED_VALUE = encodeURIComponent(
	SETTINGS_REDACTED_VALUE,
).toLowerCase();

/** Percent-decoding passes, matching the redactor's nested-URL depth. */
const MAX_PLACEHOLDER_DECODE_DEPTH = 3;

/**
 * How much of a parameter name, counted back from its "=", decides whether
 * it is credential-named. The decision rests on the name's last word, so
 * capping the read keeps every check linear in the value's length.
 */
const MAX_PARAMETER_NAME_TAIL = 256;

/** An encoded authority start right before an encoded marker. */
const ENCODED_AUTHORITY_START = /(?:%3a|:)(?:%2f|\/){2}$/i;

/**
 * Whether `value` has the ASCII `needle` (lowercase) at `index`, ignoring
 * case. Only the compared slice is lowercased: lowercasing the whole value
 * can change its length (e.g. "İ") and shift every later index.
 */
function hasTextAt(value: string, index: number, needle: string): boolean {
	return value.slice(index, index + needle.length).toLowerCase() === needle;
}

interface ParameterAssignment {
	index: number;
	nameStarts: readonly number[];
	credential?: boolean;
}

/** Decode valid escape runs independently so malformed escapes don't hide later markers. */
function decodeValidPercentEscapes(value: string): string {
	return value.replace(/\+/g, " ").replace(/(?:%[\da-f]{2})+/gi, (run) => {
		try {
			return decodeURIComponent(run);
		} catch {
			// Decode ASCII escapes such as %25/%3F without interpreting invalid
			// non-ASCII byte sequences as Unicode.
			return run.replace(/%([0-7][\da-f])/gi, (_, hex: string) =>
				String.fromCharCode(Number.parseInt(hex, 16)),
			);
		}
	});
}

/**
 * Whether an assignment names a credential parameter. The redactor reads a
 * parameter name back to the nearest "?", "&", "#", or ";" in free text, to
 * the nearest "&" or ";" inside a URL query, and to a percent-encoded
 * separator inside an encoded nested URL, so every one of those readings is
 * tried, each with and without decoding the name's valid escapes.
 */
function isCredentialAssignment(
	value: string,
	assignment: ParameterAssignment | undefined,
): boolean {
	if (assignment === undefined) return false;
	if (assignment.credential === undefined) {
		const tailStart = Math.max(0, assignment.index - MAX_PARAMETER_NAME_TAIL);
		assignment.credential = assignment.nameStarts.some((nameStart) => {
			const name = value.slice(Math.max(nameStart, tailStart), assignment.index);
			return (
				isSettingsCredentialQueryParameter(name) ||
				isSettingsCredentialQueryParameter(decodeValidPercentEscapes(name))
			);
		});
	}
	return assignment.credential;
}

function isSchemeCharacter(character: string): boolean {
	return /^[a-z0-9+.-]$/i.test(character);
}

function isAuthoritySlash(character: string | undefined): boolean {
	return character === "/" || character === "\\";
}

/**
 * Scan one form of a value, in a single pass, for a marker in a position the
 * redactor writes it: the userinfo of a URL authority, or the value of a
 * credential-named parameter.
 */
function hasPlaceholderMarker(value: string): boolean {
	let afterSeparator = 0;
	let afterPairSeparator = 0;
	let afterAnySeparator = 0;
	let afterAssignment = 0;
	let assignment: ParameterAssignment | undefined;
	let schemeHasLetter = false;
	let inAuthority = false;
	let index = 0;
	while (index < value.length) {
		if (value.startsWith(SETTINGS_REDACTED_VALUE, index)) {
			const end = index + SETTINGS_REDACTED_VALUE.length;
			if (
				(inAuthority && value[end] === "@") ||
				isCredentialAssignment(value, assignment)
			) {
				return true;
			}
		} else if (
			value[index] === "%" &&
			hasTextAt(value, index, ENCODED_REDACTED_VALUE)
		) {
			const end = index + ENCODED_REDACTED_VALUE.length;
			if (
				(hasTextAt(value, end, "%40") &&
					ENCODED_AUTHORITY_START.test(
						value.slice(Math.max(0, index - 9), index),
					)) ||
				isCredentialAssignment(value, assignment)
			) {
				return true;
			}
		}

		const character = value[index] ?? "";
		if (
			character === ":" &&
			schemeHasLetter &&
			isAuthoritySlash(value[index + 1]) &&
			isAuthoritySlash(value[index + 2])
		) {
			// An absolute URL's authority starts after "scheme://" (or the
			// "\\" WHATWG parsers accept) and ends at its first "/?#\".
			inAuthority = true;
			schemeHasLetter = false;
			index += 3;
			continue;
		}
		if (/[a-z]/i.test(character)) {
			schemeHasLetter = true;
		} else if (!isSchemeCharacter(character)) {
			schemeHasLetter = false;
		}
		if (inAuthority && /[/?#\\]/.test(character)) {
			inAuthority = false;
		}

		if (/[?&#;]/.test(character)) {
			afterSeparator = index + 1;
			afterAnySeparator = index + 1;
			if (character === "&" || character === ";") {
				afterPairSeparator = index + 1;
			}
		} else if (
			character === "%" &&
			/^%(?:3f|26|23|3b)$/i.test(value.slice(index, index + 3))
		) {
			afterAnySeparator = index + 3;
		}

		const isLiteralAssignment = character === "=";
		if (
			isLiteralAssignment ||
			(character === "%" && hasTextAt(value, index, "%3d"))
		) {
			// A parameter name never contains a literal "=", so no reading
			// reaches back past the previous one.
			assignment = {
				index,
				nameStarts: [
					...new Set(
						[afterSeparator, afterPairSeparator, afterAnySeparator].map(
							(start) => Math.max(start, afterAssignment),
						),
					),
				],
			};
			if (isLiteralAssignment) afterAssignment = index + 1;
		}
		index += 1;
	}
	return false;
}

/**
 * Whether a settings string carries the redaction marker where a redacted
 * settings read puts it: as the whole value, as the userinfo of a URL
 * (`https://[redacted]@host`), or as the value of a credential-named query,
 * fragment, or free-text parameter (`?token=[redacted]`). The string is read
 * as written and after each of up to three percent-decoding passes, which
 * covers markers inside encoded nested URLs. Other mentions of the marker,
 * such as prose or a non-credential parameter, are not placeholders.
 */
export function hasRedactedSettingsPlaceholder(value: string): boolean {
	let form = value;
	for (let depth = 0; ; depth += 1) {
		if (form === SETTINGS_REDACTED_VALUE || hasPlaceholderMarker(form)) {
			return true;
		}
		if (depth === MAX_PLACEHOLDER_DECODE_DEPTH || !form.includes("%")) {
			return false;
		}
		const decoded = decodeValidPercentEscapes(form);
		if (decoded === form) return false;
		form = decoded;
	}
}

/**
 * Read a document the way the JSON request body will carry it. A value JSON
 * cannot serialize, such as a cyclic one, is read as written instead, so the
 * guard raises nothing but placeholder errors and the request still fails in
 * the client's own serializer.
 */
function toJsonDocument(document: unknown): unknown {
	try {
		const serialized = JSON.stringify(document, (_key, value: unknown) =>
			typeof value === "bigint" ? value.toString() : value,
		);
		return serialized === undefined ? undefined : JSON.parse(serialized);
	} catch {
		return document;
	}
}

function appendKeyToPath(path: string, key: string): string {
	if (!/^[\w.-]+$/.test(key)) return `${path}[${JSON.stringify(key)}]`;
	return path === "" ? key : `${path}.${key}`;
}

/**
 * The key path of every string in a settings document that still carries the
 * redaction placeholder (see `hasRedactedSettingsPlaceholder`), in document
 * order, such as `smtp[0].password` or `security.oidc.client_secret`. The
 * document is read in its JSON form, exactly as a request would send it.
 */
export function findRedactedSettingsPlaceholderPaths(
	document: unknown,
): string[] {
	const paths: string[] = [];
	const visited = new WeakSet<object>();
	const pending: Array<{ path: string; value: unknown }> = [
		{ path: "", value: toJsonDocument(document) },
	];
	while (pending.length > 0) {
		const { path, value } = pending.pop() as { path: string; value: unknown };
		if (typeof value === "string") {
			if (hasRedactedSettingsPlaceholder(value)) paths.push(path || "(root)");
			continue;
		}
		if (value === null || typeof value !== "object" || visited.has(value)) {
			continue;
		}
		visited.add(value);
		const children = Array.isArray(value)
			? value.map((entry, position) => ({
					path: `${path}[${position}]`,
					value: entry as unknown,
				}))
			: Object.entries(value).map(([key, entry]) => ({
					path: appendKeyToPath(path, key),
					value: entry as unknown,
				}));
		for (let position = children.length - 1; position >= 0; position -= 1) {
			const child = children[position];
			if (child !== undefined) pending.push(child);
		}
	}
	return paths;
}

/** A settings request that carries stored credentials to Listmonk. */
export type RedactedSettingsWrite = "update" | "test SMTP";

/**
 * Secrets that Listmonk 6.2's `PUT /api/settings` handler (`UpdateSettings`
 * in cmd/settings.go) copies from the stored settings when the request sends
 * them empty. The handler binds the request into a zeroed settings struct and
 * saves every key of it, so any other key is stored exactly as sent, and a
 * key left out of the request is reset to its zero value.
 */
const SECRETS_KEPT_WHEN_EMPTY = new Set([
	"upload.s3.aws_secret_access_key",
	"bounce.sendgrid_key",
	"bounce.azure.shared_secret",
	"bounce.postmark.password",
	"bounce.forwardemail.key",
	"bounce.lettermint.key",
	"security.captcha.hcaptcha.secret",
	"security.oidc.client_secret",
]);

/**
 * Per-entry passwords the handler copies from the stored entry with the same
 * `uuid` when they arrive empty; an entry without its stored `uuid` gets a new
 * one and keeps nothing.
 */
const ENTRY_PASSWORD_KEPT_WHEN_EMPTY =
	/^(?:smtp|messengers|bounce\.mailboxes)\[\d+\]\.password$/;

const MAX_LISTED_PLACEHOLDER_PATHS = 20;

function listPlaceholderPaths(paths: readonly string[]): string {
	const listed = paths.slice(0, MAX_LISTED_PLACEHOLDER_PATHS).join(", ");
	const remaining = paths.length - MAX_LISTED_PLACEHOLDER_PATHS;
	return remaining > 0 ? `${listed}, and ${remaining} more` : listed;
}

function isSecretKeptWhenEmpty(path: string): boolean {
	return (
		SECRETS_KEPT_WHEN_EMPTY.has(path) ||
		ENTRY_PASSWORD_KEPT_WHEN_EMPTY.test(path)
	);
}

function formatRedactedSettingsPlaceholderMessage(
	write: RedactedSettingsWrite,
	paths: readonly string[],
): string {
	const sentences = [
		`Cannot ${write} settings: ${listPlaceholderPaths(paths)} still ${paths.length === 1 ? "holds" : "hold"} the "${SETTINGS_REDACTED_VALUE}" placeholder that redacted settings reads return in place of credentials, so no request was sent.`,
	];
	if (write === "test SMTP") {
		sentences.push(
			"Listmonk's SMTP test authenticates only with the credentials in the request and never falls back to the stored ones, so send the real values.",
		);
		return sentences.join(" ");
	}
	sentences.push("Listmonk would save the placeholder as the real value.");
	const realValueOnly = paths.filter((path) => !isSecretKeptWhenEmpty(path));
	const keptWhenEmpty = paths.filter(isSecretKeptWhenEmpty);
	if (realValueOnly.length > 0) {
		sentences.push(
			`Send the real value for ${listPlaceholderPaths(realValueOnly)}: Listmonk 6.2 saves the whole settings document on update, so leaving a key out resets it instead of keeping the stored value.`,
		);
	}
	if (keptWhenEmpty.length > 0) {
		sentences.push(
			`For ${listPlaceholderPaths(keptWhenEmpty)}, send the real value or an empty string, which keeps the stored secret${keptWhenEmpty.some((path) => ENTRY_PASSWORD_KEPT_WHEN_EMPTY.test(path)) ? " as long as the entry keeps its stored uuid" : ""}.`,
		);
	}
	return sentences.join(" ");
}

/**
 * Raised before a settings request is sent when the document still carries
 * redaction placeholders. `paths` names the offending keys; their values are
 * never part of the error.
 */
export class RedactedSettingsPlaceholderError extends TypeError {
	public readonly write: RedactedSettingsWrite;
	public readonly paths: readonly string[];

	public constructor(write: RedactedSettingsWrite, paths: readonly string[]) {
		super(formatRedactedSettingsPlaceholderMessage(write, paths));
		this.name = "RedactedSettingsPlaceholderError";
		this.write = write;
		this.paths = [...paths];
	}
}

/**
 * Fail closed before a settings write: throw a
 * `RedactedSettingsPlaceholderError` naming every key path that still
 * carries a redaction placeholder, so a redacted settings read cannot be
 * written back over the stored credentials.
 */
export function assertNoRedactedSettingsPlaceholders(
	document: unknown,
	write: RedactedSettingsWrite,
): void {
	const paths = findRedactedSettingsPlaceholderPaths(document);
	if (paths.length > 0) {
		throw new RedactedSettingsPlaceholderError(write, paths);
	}
}
