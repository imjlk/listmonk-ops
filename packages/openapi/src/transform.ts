/**
 * Response transformation utilities for Listmonk API
 * Handles the flattening of nested data structures
 */

/**
 * Recursively flattens nested data structures
 * Specifically handles Listmonk's data.data.data... patterns
 */
const flattenData = (obj: unknown): unknown => {
	if (!obj || typeof obj !== 'object') return obj;

	const objRecord = obj as Record<string, unknown>;

	// If object has a 'data' property that contains another object with 'data'
	if (objRecord.data && typeof objRecord.data === 'object' && objRecord.data !== null) {
		const dataRecord = objRecord.data as Record<string, unknown>;
		if ('data' in dataRecord) {
			const result: Record<string, unknown> = {
				...objRecord,
				data: dataRecord.data,
			};

			// Preserve other properties from the nested data object
			if (dataRecord.message) {
				result.message = dataRecord.message;
			}

			// Add other properties (excluding 'data' and 'message')
			Object.entries(dataRecord).forEach(([key, value]) => {
				if (key !== 'data' && key !== 'message') {
					result[key] = value;
				}
			});

			return flattenData(result);
		}
	}

	return obj;
};

/**
 * Transforms API responses to remove nested data structure
 * @param response - The response object to transform
 * @returns Flattened response object
 */
export const transformResponse = async (response: unknown): Promise<unknown> => {
	if (!response || typeof response !== "object") return response;
	return flattenData(response);
};

/**
 * Synchronous version of transformResponse for cases where async is not needed
 * @param response - The response object to transform
 * @returns Flattened response object
 */
export const transformResponseSync = (response: unknown): unknown => {
	if (!response || typeof response !== "object") return response;
	return flattenData(response);
};
