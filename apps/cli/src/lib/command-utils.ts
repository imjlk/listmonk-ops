import { z } from "zod";

export function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	if (error && typeof error === "object") {
		if ("message" in error && typeof error.message === "string") {
			return error.message;
		}

		if ("error" in error && typeof error.error === "string") {
			return error.error;
		}

		try {
			return JSON.stringify(error);
		} catch {
			// Fall through to String conversion.
		}
	}

	return String(error);
}

const POSITIVE_DECIMAL_INTEGER = /^[1-9][0-9]*$/;

/**
 * Parse one Listmonk resource ID. Only positive decimal digits are accepted:
 * `Number()` would turn `0x10` into 16, `1e1` into 10, and `1.0` into 1,
 * silently addressing a different resource than the one typed.
 */
export function parsePositiveIntegerId(token: string, label: string): number {
	const value = token.trim();
	if (!POSITIVE_DECIMAL_INTEGER.test(value)) {
		throw new Error(`Invalid ${label} '${value}': expected a positive integer`);
	}
	const id = Number(value);
	if (!Number.isSafeInteger(id)) {
		throw new Error(
			`Invalid ${label} '${value}': exceeds the maximum safe integer (${Number.MAX_SAFE_INTEGER})`,
		);
	}
	return id;
}

/**
 * Parse a comma-separated ID list. One malformed entry aborts the command:
 * dropping it would shrink a set that update commands write back as a
 * replacement for the current memberships.
 */
export function parseCsvNumbersStrict(
	input: string | undefined,
	label: string,
): number[] {
	if (!input) {
		throw new Error(`Expected a comma-separated list of ${label}`);
	}
	return input.split(",").map((token) => parsePositiveIntegerId(token, label));
}

/** Option schema for a scalar resource ID flag such as `--id` or `--campaign-id`. */
export const positiveIntegerIdSchema = z
	.string()
	.trim()
	.regex(POSITIVE_DECIMAL_INTEGER, {
		error: (issue) =>
			`expected a positive decimal integer, received ${JSON.stringify(issue.input)}`,
	})
	.transform(Number)
	.refine(Number.isSafeInteger, {
		error: `exceeds the maximum safe integer (${Number.MAX_SAFE_INTEGER})`,
	});

export function parseJson<T>(input: string, label: string): T {
	try {
		return JSON.parse(input) as T;
	} catch {
		throw new Error(`Invalid JSON for ${label}`);
	}
}

export function hasApiError<T extends object>(
	response: T | { error: unknown },
): response is { error: unknown } {
	return "error" in response;
}
