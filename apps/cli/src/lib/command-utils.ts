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

export function parseCsvNumbers(input: string | undefined): number[] {
	if (!input) {
		return [];
	}

	const numbers = input
		.split(",")
		.map((value) => Number(value.trim()))
		.filter((value) => Number.isFinite(value) && value > 0);

	if (numbers.length === 0) {
		throw new Error("Expected a comma-separated list of positive numbers");
	}

	return numbers;
}

/**
 * Strict variant of {@link parseCsvNumbers} for bulk operations where a
 * single malformed ID must abort the entire command. Unlike
 * {@link parseCsvNumbers}, this rejects any token that is not a positive
 * finite integer — it does not silently drop invalid tokens.
 */
export function parseCsvNumbersStrict(
	input: string | undefined,
	label: string,
): number[] {
	if (!input) {
		throw new Error(`Expected a comma-separated list of ${label}`);
	}
	const tokens = input.split(",").map((value) => value.trim());
	const numbers: number[] = [];
	for (const token of tokens) {
		if (!/^[1-9][0-9]*$/.test(token)) {
			throw new Error(
				`Invalid ${label} '${token}': expected a positive integer`,
			);
		}
		numbers.push(Number(token));
	}
	return numbers;
}

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
