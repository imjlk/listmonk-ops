/**
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
function compareKeys(left, right) {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

/**
 * Normalize JSON-like contract data for deterministic generation and
 * compatibility comparisons. JSON Schema dialect annotations are transport
 * metadata, so they do not participate in normalized operation contracts.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function stableValue(value) {
	if (Array.isArray(value)) {
		return value.map(stableValue);
	}
	if (typeof value === "object" && value !== null) {
		return Object.fromEntries(
			Object.entries(value)
				.filter(
					([key, nested]) =>
						key !== "$schema" && nested !== undefined,
				)
				.sort(([left], [right]) => compareKeys(left, right))
				.map(([key, nested]) => [key, stableValue(nested)]),
		);
	}
	return value;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function stableJson(value) {
	return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}
