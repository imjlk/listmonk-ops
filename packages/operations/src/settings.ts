import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	isSettingsCredentialQueryParameter,
	SETTINGS_REDACTED_VALUE,
} from "@listmonk-ops/openapi";
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

export { SETTINGS_REDACTED_VALUE };

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
 * The start of an absolute URL with an authority: an RFC 3986 scheme and
 * `//` (or the `\\` WHATWG parsers accept for special schemes). Requiring
 * the authority keeps `mailto:` addresses, hostnames, email addresses, and
 * CSS rules such as `a:hover` out.
 */
const ABSOLUTE_URL_PREFIX = /^[a-z][a-z0-9+.-]*:[\\/]{2}/i;
const ABSOLUTE_URL_PREFIX_ANYWHERE = /[a-z][a-z0-9+.-]*:[\\/]{2}/i;
const MAX_ENCODED_URL_NESTING_DEPTH = 3;

function findAbsoluteUrlPrefix(
	value: string,
	fromIndex = 0,
): { index: number; prefix: string } | undefined {
	const match = ABSOLUTE_URL_PREFIX_ANYWHERE.exec(value.slice(fromIndex));
	if (match === null || match.index === undefined) return undefined;
	return { index: fromIndex + match.index, prefix: match[0] };
}

function findAbsoluteUrlPrefixes(value: string): Array<{ index: number; prefix: string }> {
	const pattern = new RegExp(ABSOLUTE_URL_PREFIX_ANYWHERE.source, "gi");
	const prefixes: Array<{ index: number; prefix: string }> = [];
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(value)) !== null) {
		if (match.index !== undefined) {
			prefixes.push({ index: match.index, prefix: match[0] });
		}
	}
	return prefixes;
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

function isCredentialQueryParameter(encodedName: string): boolean {
	return isSettingsCredentialQueryParameter(encodedName);
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
		// The nested-query pass can see a value already replaced by the spaced
		// credential pass. That pass preserves wrappers only after matching them.
		if (isAlreadyRedactedCredentialValue(value)) {
			continue;
		}
		parts[index] = `${parameter.slice(0, separator + 1)}${SETTINGS_REDACTED_VALUE}`;
		redacted = true;
	}
	return redacted ? parts.join("") : text;
}

function isAlreadyRedactedCredentialValue(value: string): boolean {
	return (
		value.startsWith(SETTINGS_REDACTED_VALUE) &&
		/^[)\]}>'",.]*$/.test(value.slice(SETTINGS_REDACTED_VALUE.length))
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

/** Keep query-like characters inside a malformed URL authority as userinfo. */
function isUrlAuthorityDelimiterInsideUserinfo(
	value: string,
	delimiterIndex: number,
	urlPrefix: { index: number; prefix: string } | undefined,
	closingAtByUrlPrefix: Map<number, number | null>,
): boolean {
	if (urlPrefix === undefined) return false;
	const cachedClosingAt = closingAtByUrlPrefix.get(urlPrefix.index);
	if (cachedClosingAt !== undefined) {
		return cachedClosingAt !== null && delimiterIndex < cachedClosingAt;
	}
	const authorityStart = urlPrefix.index + urlPrefix.prefix.length;
	const parsedBeforeDelimiter = parseUrl(
		value.slice(urlPrefix.index, delimiterIndex),
	);
	if (parsedBeforeDelimiter !== undefined) {
		closingAtByUrlPrefix.set(urlPrefix.index, null);
		return false;
	}
	const relativeClosingAt = spacedUserinfoClosingAt(
		urlPrefix.prefix,
		value.slice(authorityStart),
	);
	if (relativeClosingAt === -1) {
		closingAtByUrlPrefix.set(urlPrefix.index, null);
		return false;
	}
	const closingAt = authorityStart + relativeClosingAt;
	closingAtByUrlPrefix.set(urlPrefix.index, closingAt);
	return delimiterIndex < closingAt;
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
	const urlPrefixes = findAbsoluteUrlPrefixes(value);
	const closingAtByUrlPrefix = new Map<number, number | null>();
	let urlPrefixCursor = 0;
	let nearestUrlPrefix: { index: number; prefix: string } | undefined;
	let scanFrom = 0;
	while (scanFrom < value.length) {
		const delimiterPattern = /[?&#;]/g;
		delimiterPattern.lastIndex = scanFrom;
		// Bare query assignments have no leading separator, e.g. token=…&channel=sms.
		const hasStartAssignment =
			scanFrom === 0 && /^[^=?&#;\s]+=/.test(value);
		let nameStart = 0;
		if (!hasStartAssignment) {
			const delimiter = delimiterPattern.exec(value);
			if (delimiter === null || delimiter.index === undefined) break;
			while (
				urlPrefixCursor < urlPrefixes.length &&
				(urlPrefixes[urlPrefixCursor]?.index ?? value.length) <
					delimiter.index
			) {
				nearestUrlPrefix = urlPrefixes[urlPrefixCursor];
				urlPrefixCursor += 1;
			}
			if (
				isUrlAuthorityDelimiterInsideUserinfo(
					value,
					delimiter.index,
					nearestUrlPrefix,
					closingAtByUrlPrefix,
				)
			) {
				scanFrom = delimiter.index + 1;
				continue;
			}
			nameStart = delimiter.index + 1;
		}

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
		const wrapperEnd = findCredentialValueWrapperBoundary(value, valueStart);
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
			wrapperEnd ?? explicitValueEnd,
		);
		const parameterValue = value.slice(valueStart, valueEnd);
		if (parameterValue !== SETTINGS_REDACTED_VALUE) {
			let secretEnd = valueEnd;
			while (secretEnd > valueStart && /\s/.test(value[secretEnd - 1] ?? "")) {
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
	return replaceTextRanges(value, replacements, SETTINGS_REDACTED_VALUE);
}

/**
 * Find a closing URL wrapper only when its opener is outside the query value
 * and non-wrapper credential text appears before it.
 */
function findCredentialValueWrapperBoundary(
	value: string,
	valueStart: number,
): number | undefined {
	const wrapperPattern = /[)\]}>'"]/g;
	wrapperPattern.lastIndex =
		valueStart +
		(value.startsWith(SETTINGS_REDACTED_VALUE, valueStart)
			? SETTINGS_REDACTED_VALUE.length
			: 0);
	let wrapper = wrapperPattern.exec(value);
	while (wrapper !== null && wrapper.index !== undefined) {
		const index = wrapper.index;
		const secretPart = value.slice(valueStart, index);
		const suffix = value.slice(index + wrapper[0].length);
		if (
			/[^\s)\]}>'\",]/.test(secretPart) &&
			/^[)\]}>'\",.]*(?:[&;#?]|\s|$)/.test(suffix) &&
			hasMatchingOpeningWrapper(value, valueStart, wrapper[0])
		) {
			return index;
		}
		wrapper = wrapperPattern.exec(value);
	}
	return undefined;
}

/** Check whether a closing delimiter matches an opener before the value. */
function hasMatchingOpeningWrapper(
	value: string,
	valueStart: number,
	closing: string,
): boolean {
	const prefix = value.slice(0, valueStart);
	const pair: Record<string, string> = {
		")": "(",
		"]": "[",
		"}": "{",
		">": "<",
		"'": "'",
		'"': '"',
	};
	const opening = pair[closing];
	if (opening === undefined) return false;
	if (opening === closing) {
		return [...prefix].filter((character) => character === closing).length % 2 === 1;
	}
	return prefix.lastIndexOf(opening) > prefix.lastIndexOf(closing);
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
function redactAbsoluteUrl(
	prefix: string,
	rest: string,
	spacedUserinfoEndOverride?: number,
): string {
	const at = spacedUserinfoEndOverride ?? userinfoEnd(prefix, rest);
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

interface DecodedTextWithSourceOffsets {
	text: string;
	sourceStarts: number[];
	sourceEnds: number[];
}

interface TextRange {
	start: number;
	end: number;
}

const SETTINGS_REDACTED_MARKERS = [SETTINGS_REDACTED_VALUE];
for (let depth = 0; depth < MAX_ENCODED_URL_NESTING_DEPTH; depth += 1) {
	const previous = SETTINGS_REDACTED_MARKERS.at(-1);
	if (previous !== undefined) {
		SETTINGS_REDACTED_MARKERS.push(encodeURIComponent(previous));
	}
}
SETTINGS_REDACTED_MARKERS.reverse();

function redactedMarkerAt(
	value: string,
	index: number,
): string | undefined {
	for (const marker of SETTINGS_REDACTED_MARKERS) {
		const candidate = value.slice(index, index + marker.length);
		if (
			marker.includes("%")
				? candidate.toLowerCase() === marker.toLowerCase()
				: candidate === marker
		) {
			return marker;
		}
	}
	return undefined;
}

function nextRedactedMarker(
	value: string,
	fromIndex: number,
): { index: number; marker: string } | undefined {
	let next: { index: number; marker: string } | undefined;
	for (const marker of SETTINGS_REDACTED_MARKERS) {
		const index = marker.includes("%")
			? value.toLowerCase().indexOf(marker.toLowerCase(), fromIndex)
			: value.indexOf(marker, fromIndex);
		if (index !== -1 && (next === undefined || index < next.index)) {
			next = { index, marker };
		}
	}
	return next;
}

/** Ranges must be sorted in ascending order and must not overlap. */
function replaceTextRanges(
	value: string,
	ranges: readonly TextRange[],
	replacement: string,
): string {
	if (ranges.length === 0) return value;
	const parts: string[] = [];
	let cursor = 0;
	for (const range of ranges) {
		parts.push(value.slice(cursor, range.start), replacement);
		cursor = range.end;
	}
	parts.push(value.slice(cursor));
	return parts.join("");
}

function readPercentEncodedByte(value: string, index: number): number | undefined {
	if (value[index] !== "%") return undefined;
	const hex = value.slice(index + 1, index + 3);
	if (!/^[\da-f]{2}$/i.test(hex)) return undefined;
	return Number.parseInt(hex, 16);
}

function appendMappedText(
	decoded: string[],
	sourceStarts: number[],
	sourceEnds: number[],
	text: string,
	sourceStart: number,
	sourceEnd: number,
): void {
	decoded.push(text);
	for (let unit = 0; unit < text.length; unit += 1) {
		sourceStarts.push(sourceStart);
		sourceEnds.push(sourceEnd);
	}
}

/** Decode form-style URL text while retaining each decoded code unit's source span. */
function decodeUrlTextWithSourceOffsets(
	value: string,
): DecodedTextWithSourceOffsets | undefined {
	const decoded: string[] = [];
	const sourceStarts: number[] = [];
	const sourceEnds: number[] = [];
	const preserveEncodedTriplet = (start: number): number => {
		appendMappedText(
			decoded,
			sourceStarts,
			sourceEnds,
			value.slice(start, start + 3),
			start,
			start + 3,
		);
		return start + 3;
	};
	for (let index = 0; index < value.length; ) {
		if (value[index] === "+") {
			appendMappedText(
				decoded,
				sourceStarts,
				sourceEnds,
				" ",
				index,
				index + 1,
			);
			index += 1;
			continue;
		}
		if (value[index] === "%") {
			const firstByte = readPercentEncodedByte(value, index);
			if (firstByte === undefined) {
				appendMappedText(
					decoded,
					sourceStarts,
					sourceEnds,
					"%",
					index,
					index + 1,
				);
				index += 1;
				continue;
			}
			const byteCount =
				firstByte <= 0x7f
					? 1
					: firstByte >= 0xc2 && firstByte <= 0xdf
						? 2
						: firstByte >= 0xe0 && firstByte <= 0xef
							? 3
							: firstByte >= 0xf0 && firstByte <= 0xf4
								? 4
								: 0;
			if (byteCount === 0) {
				index = preserveEncodedTriplet(index);
				continue;
			}
			let sourceEnd = index + 3;
			for (let byteIndex = 1; byteIndex < byteCount; byteIndex += 1) {
				const continuation = readPercentEncodedByte(value, sourceEnd);
				if (
					continuation === undefined ||
					continuation < 0x80 ||
					continuation > 0xbf
				) {
					break;
				}
				sourceEnd += 3;
			}
			if (sourceEnd !== index + 3 * byteCount) {
				index = preserveEncodedTriplet(index);
				continue;
			}
			let character: string;
			try {
				character = decodeURIComponent(value.slice(index, sourceEnd));
			} catch {
				index = preserveEncodedTriplet(index);
				continue;
			}
			if ([...character].length !== 1) return undefined;
			appendMappedText(
				decoded,
				sourceStarts,
				sourceEnds,
				character,
				index,
				sourceEnd,
			);
			index = sourceEnd;
			continue;
		}

		const sourceStart = index;
		const codePoint = value.codePointAt(index);
		if (codePoint === undefined) return undefined;
		const character = String.fromCodePoint(codePoint);
		const sourceEnd = index + character.length;
		appendMappedText(
			decoded,
			sourceStarts,
			sourceEnds,
			character,
			sourceStart,
			sourceEnd,
		);
		index = sourceEnd;
	}
	return { text: decoded.join(""), sourceStarts, sourceEnds };
}

/** Locate source spans changed only by this redactor's `[redacted]` replacements. */
function findRedactionRanges(
	original: string,
	redacted: string,
): TextRange[] | undefined {
	const ranges: TextRange[] = [];
	let originalIndex = 0;
	let redactedIndex = 0;
	while (redactedIndex < redacted.length) {
		const originalMarker = redactedMarkerAt(original, originalIndex);
		const redactedMarker = redactedMarkerAt(redacted, redactedIndex);
		const markerAlreadyAligned =
			originalMarker !== undefined &&
			redactedMarker?.toLowerCase() === originalMarker.toLowerCase();
		const markerSuffixMatches =
			originalMarker !== undefined &&
			original[originalIndex + originalMarker.length] ===
				redacted[redactedIndex + (redactedMarker?.length ?? 0)];
		if (
			original[originalIndex] === redacted[redactedIndex] &&
			(!markerAlreadyAligned || markerSuffixMatches)
		) {
			originalIndex += 1;
			redactedIndex += 1;
			continue;
		}
		if (redactedMarker === undefined) {
			return undefined;
		}
		const markerEnd = redactedIndex + redactedMarker.length;
		const nextMarker = nextRedactedMarker(redacted, markerEnd);
		const unchangedEnd = nextMarker?.index ?? redacted.length;
		const unchangedSuffix = redacted.slice(markerEnd, unchangedEnd);
		if (unchangedSuffix === "" && nextMarker !== undefined) {
			return undefined;
		}
		const originalEnd =
			unchangedSuffix === ""
				? original.length
				: nextMarker === undefined
					? original.endsWith(unchangedSuffix)
						? original.length - unchangedSuffix.length
						: -1
					: original.indexOf(unchangedSuffix, originalIndex);
		if (originalEnd < originalIndex || originalEnd === -1) return undefined;
		ranges.push({ start: originalIndex, end: originalEnd });
		originalIndex = originalEnd;
		redactedIndex = markerEnd;
	}
	return originalIndex === original.length ? ranges : undefined;
}

function findEncodedAbsoluteUrlPrefix(
	value: string,
	fromIndex: number,
): { index: number; prefixLength: number } | undefined {
	const schemePattern = /[a-z][a-z0-9+.-]*/gi;
	schemePattern.lastIndex = fromIndex;
	let scheme = schemePattern.exec(value);
	while (scheme !== null && scheme.index !== undefined) {
		const schemeEnd = scheme.index + scheme[0].length;
		const delimiterLength = findEncodedUrlAuthorityDelimiterLength(
			value.slice(schemeEnd, schemeEnd + 32),
		);
		if (delimiterLength !== undefined) {
			const encodedDelimiter = value.slice(
				schemeEnd,
				schemeEnd + delimiterLength,
			);
			if (encodedDelimiter.includes("%")) {
				return {
					index: scheme.index,
					prefixLength: scheme[0].length + delimiterLength,
				};
			}
		}
		schemePattern.lastIndex = schemeEnd;
		scheme = schemePattern.exec(value);
	}
	return undefined;
}

function findEncodedUrlAuthorityDelimiterLength(value: string): number | undefined {
	let decodedValue = value;
	let sourceEnds = Array.from(
		{ length: value.length },
		(_, index) => index + 1,
	);
	for (let depth = 0; depth < MAX_ENCODED_URL_NESTING_DEPTH; depth += 1) {
		const decoded = decodeUrlTextWithSourceOffsets(decodedValue);
		if (decoded === undefined) return undefined;
		if (decoded.text.startsWith("://")) {
			const endInCurrent = decoded.sourceEnds[2];
			return endInCurrent === undefined
				? undefined
				: sourceEnds[endInCurrent - 1];
		}
		if (decoded.text === decodedValue) return undefined;
		sourceEnds = decoded.sourceEnds.map(
			(end) => sourceEnds[end - 1] ?? end,
		);
		decodedValue = decoded.text;
	}
	return undefined;
}

function openingWrapperForClosing(character: string): string | undefined {
	switch (character) {
		case ")":
			return "(";
		case "]":
			return "[";
		case "}":
			return "{";
		default:
			return undefined;
	}
}

function advanceWrapperStack(
	value: string,
	start: number,
	end: number,
	openers: string[],
): void {
	for (let index = start; index < end; index += 1) {
		const character = value[index] ?? "";
		if (character === "(" || character === "[" || character === "{") {
			openers.push(character);
			continue;
		}
		const matchingOpener = openingWrapperForClosing(character);
		if (matchingOpener !== undefined && matchingOpener === openers.at(-1)) {
			openers.pop();
		}
	}
}

function encodedUrlCandidateEnd(
	value: string,
	fromIndex: number,
	initialOpeners: readonly string[],
): number {
	const openers = [...initialOpeners];
	let index = fromIndex;
	while (index < value.length && !/[\s&;'"<>]/.test(value[index] ?? "")) {
		const character = value[index] ?? "";
		if (character === "(" || character === "[" || character === "{") {
			openers.push(character);
		} else {
			const matchingOpener = openingWrapperForClosing(character);
			if (
				matchingOpener !== undefined &&
				matchingOpener === openers.at(-1)
			) {
				if (openers.length === initialOpeners.length) return index;
				openers.pop();
			}
		}
		index += 1;
	}
	return index;
}

/**
 * Redact nested URL credentials without normalizing their percent-encoding.
 * Only the source spans corresponding to secrets are replaced; every other
 * character remains byte-for-byte as it appeared in the setting.
 */
function redactEncodedNestedUrlValues(value: string, depth: number): string {
	if (depth >= MAX_ENCODED_URL_NESTING_DEPTH) return value;
	const chunks: string[] = [];
	let sourceCursor = 0;
	let scanFrom = 0;
	const wrapperOpeners: string[] = [];
	let wrapperScanFrom = 0;
	let redactedAny = false;
	while (scanFrom < value.length) {
		const prefix = findEncodedAbsoluteUrlPrefix(value, scanFrom);
		if (prefix === undefined) break;
		advanceWrapperStack(value, wrapperScanFrom, prefix.index, wrapperOpeners);
		wrapperScanFrom = prefix.index;
		const end = encodedUrlCandidateEnd(
			value,
			prefix.index + prefix.prefixLength,
			wrapperOpeners,
		);
		const candidate = value.slice(prefix.index, end);
		const decoded = decodeUrlTextWithSourceOffsets(candidate);
		if (
			decoded === undefined ||
			(!ABSOLUTE_URL_PREFIX_ANYWHERE.test(decoded.text) &&
				findEncodedAbsoluteUrlPrefix(decoded.text, 0) === undefined)
		) {
			scanFrom = Math.max(end, prefix.index + prefix.prefixLength);
			continue;
		}
		const redacted = redactUrlCredentialsAtDepth(decoded.text, depth + 1);
		if (redacted === decoded.text) {
			scanFrom = end;
			continue;
		}
		const ranges = findRedactionRanges(decoded.text, redacted);
		if (ranges === undefined) {
			scanFrom = end;
			continue;
		}
		const sourceRanges: TextRange[] = [];
		for (const range of ranges) {
			const sourceStart = decoded.sourceStarts[range.start];
			const sourceEnd = decoded.sourceEnds[range.end - 1];
			if (sourceStart !== undefined && sourceEnd !== undefined) {
				sourceRanges.push({ start: sourceStart, end: sourceEnd });
			}
		}
		const redactedCandidate = replaceTextRanges(
			candidate,
			sourceRanges,
			encodeURIComponent(SETTINGS_REDACTED_VALUE),
		);
		if (redactedCandidate !== candidate) {
			chunks.push(value.slice(sourceCursor, prefix.index), redactedCandidate);
			sourceCursor = end;
			redactedAny = true;
		}
		scanFrom = end;
	}
	if (!redactedAny) return value;
	chunks.push(value.slice(sourceCursor));
	return chunks.join("");
}

/**
 * The index of the token that ends a URL whose userinfo contains unencoded
 * whitespace, such as the passphrase in `https://user:correct horse@host/`.
 * Only a URL token that is a bare `name:value` authority, without "@",
 * "/", "?", "#", or "\", can continue, and a "/", "?", or "#" before the
 * "@" that closes it belongs to the passphrase. If the parser rejects the
 * token, it continues through the first of the next few tokens that
 * contains "@". If it parses as `host:port`, a later token continues the
 * userinfo only when its suffix resembles a URL path, port, or syntactically
 * valid bare service host. A bare host and mailbox domain can be ambiguous;
 * when a valid domain closes numeric-first userinfo, prefer masking the
 * possible credential over preserving ambiguous prose.
 */
function spacedUserinfoEnd(
	tokens: readonly string[],
	index: number,
	prefix: string,
): number {
	const token = tokens[index] ?? "";
	const authority = token.slice(prefix.length);
	if (!authority.includes(":") || authority.includes("@")) return index;
	const parsedUrl = parseUrl(token);
	if (parsedUrl !== undefined) {
		const authorityDelimiter = authority.search(/[/?#\\]/);
		const authorityBeforeDelimiter =
			authorityDelimiter === -1
				? authority
				: authority.slice(0, authorityDelimiter);
		const portText = authorityBeforeDelimiter.slice(
			authorityBeforeDelimiter.lastIndexOf(":") + 1,
		);
		const numericFirstPassphrase =
			!parsedUrl.hostname.includes(".") &&
			!parsedUrl.hostname.includes(":") &&
			/^\d+$/.test(portText);
		if (/[/?#\\]/.test(authority) && !numericFirstPassphrase) return index;
		const last = Math.min(
			tokens.length - 1,
			index + 2 * MAX_SPACED_USERINFO_TOKENS,
		);
		for (let next = index + 2; next <= last; next += 2) {
			const candidate = tokens[next] ?? "";
			if (ABSOLUTE_URL_PREFIX.test(candidate)) return index;
			const joined = tokens.slice(index, next + 1).join("");
			if (
				spacedUserinfoClosingAt(prefix, joined.slice(prefix.length)) !== -1
			) {
				return next;
			}
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
		const joined = tokens.slice(index, next + 1).join("");
		if (
			spacedUserinfoClosingAt(prefix, joined.slice(prefix.length)) !== -1
		) {
			return next;
		}
	}
	return index;
}

/** Locate the authority-closing @ for a URL whose userinfo contains spaces. */
function spacedUserinfoClosingAt(prefix: string, rest: string): number {
	const parsedUrl = parseUrl(`${prefix}${rest}`);
	if (parsedUrl !== undefined && (parsedUrl.username !== "" || parsedUrl.password !== "")) {
		return userinfoEnd(prefix, rest);
	}
	const nextUrl = findAbsoluteUrlPrefix(rest);
	const searchEnd = nextUrl?.index ?? rest.length;
	const at = rest.lastIndexOf("@", searchEnd - 1);
	if (at === -1) return -1;
	const hostAndPath = rest.slice(at + 1, searchEnd);
	const authorityEnd = hostAndPath.search(/[/?#\\]/);
	const host = authorityEnd === -1
		? hostAndPath
		: hostAndPath.slice(0, authorityEnd);
	return isBareUrlHost(host) ? at : -1;
}

/** Check for a bare service host without confusing versions for DNS names. */
function isBareUrlHost(value: string): boolean {
	const host = value.replace(/[)\]}>'\",]+$/, "");
	if (host === "" || /[/?#\\\s@]/.test(host)) return false;
	if (/^\d+(?:\.\d+){3}$/.test(host)) {
		return host.split(".").every((octet) => Number(octet) <= 255);
	}
	const url = parseUrl(`http://${host}`);
	if (url === undefined || url.pathname !== "/" || url.search || url.hash) {
		return false;
	}
	if (url.hostname === "localhost") return true;
	const labels = url.hostname.toLowerCase().split(".");
	if (labels.length === 1) {
		return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(labels[0] ?? "");
	}
	if (labels.length < 2 || !/^[a-z]{2,63}$/.test(labels.at(-1) ?? "")) {
		return false;
	}
	return (
		labels.every((label) =>
			/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
		) && !labels.slice(1, -1).some((label) => /^\d+$/.test(label))
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
	return redactUrlCredentialsAtDepth(value, 0);
}

function redactUrlCredentialsAtDepth(value: string, depth: number): string {
	const withEncodedValues = redactEncodedNestedUrlValues(value, depth);
	const withSpacedValues = redactSpacedCredentialParameterValues(
		withEncodedValues,
	);
	const tokens = withSpacedValues.split(/(\s+)/);
	let redactedAny =
		withEncodedValues !== value || withSpacedValues !== withEncodedValues;
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
			const spacedAt =
				end > 0
					? spacedUserinfoClosingAt(
							match.prefix,
							url.slice(match.prefix.length),
						)
					: -1;
			const redacted = redactAbsoluteUrl(
				match.prefix,
				url.slice(match.prefix.length),
				spacedAt === -1 ? undefined : spacedAt,
			);
			const suffix = token.slice(candidateEnd);
			const replacedToken =
				`${token.slice(0, match.index)}${redacted}${suffix}`;
			tokens.splice(index, end + 1, replacedToken);
			if (redacted !== url) redactedAny = true;
			const nextMatchAfterRedaction = findAbsoluteUrlPrefix(
				replacedToken,
				match.index + match.prefix.length,
			);
			scanOffset = nextMatchAfterRedaction?.index ?? replacedToken.length;
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
