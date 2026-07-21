import { z } from "zod";

export const resourceIdSchema = z
	.codec(
		z.union([
			z.number().int().positive(),
			z.string().regex(/^[1-9][0-9]*$/),
		]),
		z.number().int().positive(),
		{
			decode: (value) => Number(value),
			encode: (value) => value,
		},
	)
	.describe("Listmonk resource ID");

export const optionalBooleanSchema = z.preprocess(
	(value) => {
		if (value === null || value === undefined || value === "") {
			return undefined;
		}
		if (value === "true") {
			return true;
		}
		if (value === "false") {
			return false;
		}
		return value;
	},
	z.boolean().optional(),
);

export const positiveIntegerSchema = z.number().int().positive();
export const positiveIntegerInputSchema = z.union([
	positiveIntegerSchema,
	z.string().regex(/^[1-9][0-9]*$/).transform(Number),
]);

export const listPageOutputSchema = z.object({
	results: z.array(z.looseObject({})),
	total: z.number(),
	per_page: z.number(),
	page: z.number(),
});

export type ResponseWithData<T> = {
	data?: T;
	error?: unknown;
};

export function toResourceErrorMessage(error: unknown): string {
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
			// Fall through to String conversion for non-serializable values.
		}
	}
	return String(error);
}

export function unwrapResourceResponse<T>(
	response: ResponseWithData<T>,
	context: string,
): T {
	if (response.error !== undefined) {
		throw new Error(`${context}: ${toResourceErrorMessage(response.error)}`);
	}
	if (response.data === undefined) {
		throw new Error(`${context}: received empty data`);
	}
	return response.data;
}

export function normalizeResourceList<T>(
	data: { results?: T[]; total?: number; per_page?: number; page?: number },
	defaults: { per_page: number; page: number },
): { results: T[]; total: number; per_page: number; page: number } {
	return {
		results: data.results ?? [],
		total: data.total ?? data.results?.length ?? 0,
		per_page: data.per_page ?? defaults.per_page,
		page: data.page ?? defaults.page,
	};
}

export function jsonResourceValue(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

export const readResourceSafety = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: true,
} as const;

export const createResourceSafety = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: false,
	openWorldHint: true,
} as const;

export const updateResourceSafety = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: true,
} as const;

export const deleteResourceSafety = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: true,
	openWorldHint: true,
} as const;
