export type FlattenedResponse<T> = {
	data: T;
	request: Request;
	response: Response;
};

export type CrudResult<T> = FlattenedResponse<T> | { error: unknown };

export type ListPayload<T> = {
	results: T[];
	total: number;
	per_page: number;
	page: number;
};

export type ErrorEnvelope = {
	error: unknown;
	request?: Request;
	response?: Response;
};

export type ListResult<T> = FlattenedResponse<ListPayload<T>> | (ErrorEnvelope & {
	data: ListPayload<T>;
});

function flattenData(value: unknown): unknown {
	if (!value || typeof value !== "object") {
		return value;
	}

	const valueRecord = value as Record<string, unknown>;
	if (
		valueRecord.data &&
		typeof valueRecord.data === "object" &&
		valueRecord.data !== null
	) {
		const dataRecord = valueRecord.data as Record<string, unknown>;
		if ("data" in dataRecord) {
			const result: Record<string, unknown> = {
				...valueRecord,
				data: dataRecord.data,
			};

			if (dataRecord.message) {
				result.message = dataRecord.message;
			}

			for (const [key, nestedValue] of Object.entries(dataRecord)) {
				if (key !== "data" && key !== "message") {
					result[key] = nestedValue;
				}
			}

			return flattenData(result);
		}
	}

	return value;
}

export async function transformResponse(response: unknown): Promise<unknown> {
	if (!response || typeof response !== "object") {
		return response;
	}
	return flattenData(response);
}

function hasResponseError(value: unknown): value is ErrorEnvelope {
	return (
		typeof value === "object" &&
		value !== null &&
		"error" in value &&
		(value as { error?: unknown }).error !== undefined
	);
}

function normalizeListPayload<T>(data: unknown): ListResult<T>["data"] {
	if (Array.isArray(data)) {
		return {
			results: data as T[],
			total: data.length,
			per_page: data.length,
			page: 1,
		};
	}

	if (data && typeof data === "object") {
		const listData = data as Record<string, unknown>;
		if (Array.isArray(listData.results)) {
			const results = listData.results as T[];
			return {
				results,
				total:
					typeof listData.total === "number" ? listData.total : results.length,
				per_page:
					typeof listData.per_page === "number"
						? listData.per_page
						: results.length,
				page: typeof listData.page === "number" ? listData.page : 1,
			};
		}
	}

	return {
		results: [],
		total: 0,
		per_page: 0,
		page: 1,
	};
}

export function normalizeListResult<T>(response: unknown): ListResult<T> {
	if (hasResponseError(response)) {
		const normalizedData = normalizeListPayload<T>(
			(response as { data?: unknown }).data,
		);
		return {
			...(response as ErrorEnvelope),
			data: normalizedData,
		} as ListResult<T>;
	}

	const transformed = response as FlattenedResponse<unknown>;
	return {
		...transformed,
		data: normalizeListPayload<T>(transformed.data),
	} as ListResult<T>;
}
