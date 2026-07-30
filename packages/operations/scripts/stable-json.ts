function compareKeys(left: string, right: string): number {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

export function stableValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(stableValue);
	}
	if (typeof value === "object" && value !== null) {
		return Object.fromEntries(
			Object.entries(value)
				.filter(([, nested]) => nested !== undefined)
				.sort(([left], [right]) => compareKeys(left, right))
				.map(([key, nested]) => [key, stableValue(nested)]),
		);
	}
	return value;
}

export function stableJson(value: unknown): string {
	return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}
