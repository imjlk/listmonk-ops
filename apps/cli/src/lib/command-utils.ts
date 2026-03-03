export function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
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
