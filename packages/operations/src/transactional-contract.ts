/**
 * JSON-Schema-compatible structural prefilter for one bare or display-name
 * mailbox. Runtime validation adds IDNA, length, and invisible-code-point
 * checks; this dependency-free constant is also consumed by spec generation.
 */
export const TRANSACTIONAL_FROM_EMAIL_PATTERN_SOURCE =
	'^(?!.*[\\u0000-\\u001f\\u007f-\\u009f])\\s*(?:(?:(?:[^\\s@\\\\",:;<>()[\\]]+)|(?:"(?:[^"\\\\]|\\\\.)+"))@[^\\s@\\\\",:;<>()[\\]]+|(?:(?:"(?:[^"\\\\]|\\\\.)+")|(?:[^\\\\",:;<>()[\\]@]+)) *<(?:(?:[^\\s@\\\\",:;<>()[\\]]+)|(?:"(?:[^"\\\\]|\\\\.)+"))@[^\\s@\\\\",:;<>()[\\]]+>)\\s*$' as const;
