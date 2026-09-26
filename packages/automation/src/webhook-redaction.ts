/**
 * Key and value classifiers for outbound webhook payload redaction. Keys and
 * values can come from third-party provider metadata, so both classifiers are
 * single linear scans with no backtracking regular expressions.
 */

/** Credential and personal-data words that mark a key wherever they appear. */
const SENSITIVE_KEY_WORDS: ReadonlySet<string> = new Set([
	"apikey",
	"authorization",
	"cookie",
	"credential",
	"email",
	"passwd",
	"password",
	"rcpt",
	"recipient",
	"secret",
	"token",
]);

/**
 * Address-bearing header and envelope fields such as SES `mail.source`,
 * `mail.destination`, and `commonHeaders.to`/`from`. These words are generic,
 * so they mark a key only when they form a whole dot-separated key segment.
 */
const RECIPIENT_KEY_NAMES: ReadonlySet<string> = new Set([
	"bcc",
	"cc",
	"destination",
	"from",
	"sender",
	"source",
	"to",
]);

/**
 * Two-word envelope fields (`reply_to`, `mail_from`, `envelopeTo`) that are
 * specific enough to mark a key wherever they appear as adjacent words.
 */
const RECIPIENT_KEY_COMPOUNDS: ReadonlySet<string> = new Set([
	"bounceto",
	"deliveredto",
	"envelopefrom",
	"envelopeto",
	"forwardto",
	"mailfrom",
	"replyto",
	"returnpath",
]);

type CharacterClass = "upper" | "lower" | "separator";

function characterClass(code: number): CharacterClass {
	if (code >= 0x41 && code <= 0x5a) {
		return "upper";
	}
	if (
		(code >= 0x61 && code <= 0x7a) ||
		(code >= 0x30 && code <= 0x39) ||
		code >= 0x80
	) {
		return "lower";
	}
	return "separator";
}

/**
 * Split one key segment into lower-case words at separators and camel-case
 * boundaries: `subscriberEmails` -> subscriber/emails, `APIKeys` -> api/keys,
 * `Reply-To` -> reply/to.
 */
function keyWords(segment: string): string[] {
	const words: string[] = [];
	let start = -1;
	for (let index = 0; index <= segment.length; index += 1) {
		const current =
			index < segment.length
				? characterClass(segment.charCodeAt(index))
				: "separator";
		if (current === "separator") {
			if (start >= 0) {
				words.push(segment.slice(start, index).toLowerCase());
				start = -1;
			}
			continue;
		}
		if (start < 0) {
			start = index;
			continue;
		}
		if (current !== "upper") {
			continue;
		}
		const previous = characterClass(segment.charCodeAt(index - 1));
		const next =
			index + 1 < segment.length
				? characterClass(segment.charCodeAt(index + 1))
				: "separator";
		if (previous === "lower" || (previous === "upper" && next === "lower")) {
			words.push(segment.slice(start, index).toLowerCase());
			start = index;
		}
	}
	return words;
}

/**
 * Matches a word, its plural, or a digit-suffixed variant: `token`, `tokens`,
 * `token2`, and `password1` all match.
 */
function hasWordOrPlural(words: ReadonlySet<string>, word: string): boolean {
	let end = word.length;
	while (end > 0 && isAsciiDigit(word.charCodeAt(end - 1))) {
		end -= 1;
	}
	const base = word.slice(0, end);
	return (
		words.has(base) ||
		(base.length > 1 && base.endsWith("s") && words.has(base.slice(0, -1)))
	);
}

function isSensitiveKeyWord(word: string): boolean {
	return (
		hasWordOrPlural(SENSITIVE_KEY_WORDS, word) ||
		hasWordOrPlural(RECIPIENT_KEY_COMPOUNDS, word)
	);
}

/**
 * Returns true for keys that name credentials, personal data, or recipient
 * addresses in any common spelling: plural, digit-suffixed, camelCase,
 * PascalCase, snake_case, kebab-case, split compounds (`api_key`, `e-mail`,
 * `mail_from`), and dotted paths such as `mail.source`.
 */
export function isSensitiveWebhookDataKey(key: string): boolean {
	for (const segment of key.split(".")) {
		const words = keyWords(segment);
		if (words.length === 0) {
			continue;
		}
		if (hasWordOrPlural(RECIPIENT_KEY_NAMES, words.join(""))) {
			return true;
		}
		for (let index = 0; index < words.length; index += 1) {
			const word = words[index]!;
			const next = words[index + 1];
			if (
				isSensitiveKeyWord(word) ||
				(next !== undefined && isSensitiveKeyWord(`${word}${next}`))
			) {
				return true;
			}
		}
	}
	return false;
}

function isAsciiLetter(code: number): boolean {
	return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function isAsciiDigit(code: number): boolean {
	return code >= 0x30 && code <= 0x39;
}

/**
 * RFC 5322 atext plus the dot and quote specials (dot-atom and quoted-string
 * local parts), and non-ASCII characters (RFC 6531).
 */
function isLocalPartCharacter(code: number): boolean {
	return (
		isAsciiLetter(code) ||
		isAsciiDigit(code) ||
		code >= 0x80 ||
		"!#$%&'*+-/=?^_`{|}~.\"".includes(String.fromCharCode(code))
	);
}

function isDomainCharacter(code: number): boolean {
	return (
		isAsciiLetter(code) ||
		isAsciiDigit(code) ||
		code >= 0x80 ||
		code === 0x2d ||
		code === 0x2e
	);
}

/**
 * A domain needs a non-empty label, a dot, and a final label that starts with
 * a letter, as every top-level domain (including `xn--` and internationalized
 * labels) does. Version strings (`pkg@1.2.3`, `pkg@4.0.0-beta`) and IP hosts
 * are therefore not addresses.
 */
function isDomainLike(value: string, start: number, end: number): boolean {
	let last = end;
	while (last > start && value.charCodeAt(last - 1) === 0x2e) {
		last -= 1;
	}
	let dot = last - 1;
	while (dot >= start && value.charCodeAt(dot) !== 0x2e) {
		dot -= 1;
	}
	if (dot <= start || dot + 1 >= last) {
		return false;
	}
	const first = value.charCodeAt(dot + 1);
	return isAsciiLetter(first) || first >= 0x80;
}

/**
 * Returns true when a string contains something shaped like an email address,
 * including the percent-encoded `%40` form used in URLs. Each candidate domain
 * is scanned once and the search resumes after it, so the work stays linear
 * in the input length.
 */
export function containsEmailAddress(value: string): boolean {
	let index = 1;
	while (index < value.length) {
		const code = value.charCodeAt(index);
		let domainStart = -1;
		if (code === 0x40) {
			domainStart = index + 1;
		} else if (
			code === 0x25 &&
			value.charCodeAt(index + 1) === 0x34 &&
			value.charCodeAt(index + 2) === 0x30
		) {
			domainStart = index + 3;
		}
		if (domainStart < 0) {
			index += 1;
			continue;
		}
		let domainEnd = domainStart;
		while (
			domainEnd < value.length &&
			isDomainCharacter(value.charCodeAt(domainEnd))
		) {
			domainEnd += 1;
		}
		if (
			isLocalPartCharacter(value.charCodeAt(index - 1)) &&
			isDomainLike(value, domainStart, domainEnd)
		) {
			return true;
		}
		index = Math.max(domainEnd, index + 1);
	}
	return false;
}
