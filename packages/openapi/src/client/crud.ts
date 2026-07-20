import type { createClient } from "../../generated/client";
import * as sdk from "../../generated/sdk.gen";
import {
	type CrudResult,
	type FlattenedResponse,
	type ListResult,
	normalizeListResult,
	transformResponse,
} from "./response";

export interface CrudOperations<
	T,
	CreateData,
	UpdateData,
	GetData,
	GetByIdData,
	DeleteData,
> {
	create(options: CreateData): Promise<FlattenedResponse<T>>;
	list(options?: GetData): Promise<ListResult<T>>;
	getById(options: GetByIdData): Promise<CrudResult<T>>;
	update(options: UpdateData): Promise<CrudResult<T>>;
	delete(options: DeleteData): Promise<FlattenedResponse<boolean>>;
}

export interface SdkOptions {
	client: ReturnType<typeof createClient>;
}

type CrudMethod = "create" | "list" | "getById" | "update" | "delete";
type CrudMethodOverrides = Partial<Record<CrudMethod, string[]>>;
type SdkMethod = (options: unknown) => Promise<unknown>;

function resolveSdkMethod(candidateNames: string[]): SdkMethod {
	for (const methodName of candidateNames) {
		const method = (sdk as Record<string, unknown>)[methodName];
		if (typeof method === "function") {
			return method as SdkMethod;
		}
	}
	throw new Error(`SDK method not found: ${candidateNames.join(" | ")}`);
}

function createSdkMethodResolver(candidateNames: string[]): () => SdkMethod {
	let resolvedMethod: SdkMethod | undefined;
	return () => {
		resolvedMethod ??= resolveSdkMethod(candidateNames);
		return resolvedMethod;
	};
}

function mergeSdkOptions(
	sdkOptions: SdkOptions,
	options: unknown,
): unknown {
	return typeof options === "object" && options !== null
		? { ...sdkOptions, ...(options as Record<string, unknown>) }
		: sdkOptions;
}

export function createCrudOperations<T>(
	resourceName: string,
	sdkOptions: SdkOptions,
	methodOverrides: CrudMethodOverrides = {},
): CrudOperations<T, unknown, unknown, unknown, unknown, unknown> {
	const defaultMethodNames: Record<CrudMethod, string[]> = {
		create: [`create${resourceName}`],
		list: [`get${resourceName}s`],
		getById: [`get${resourceName}ById`],
		update: [`update${resourceName}ById`],
		delete: [`delete${resourceName}ById`],
	};

	const methodNames: Record<CrudMethod, string[]> = {
		create: [...(methodOverrides.create ?? []), ...defaultMethodNames.create],
		list: [...(methodOverrides.list ?? []), ...defaultMethodNames.list],
		getById: [
			...(methodOverrides.getById ?? []),
			...defaultMethodNames.getById,
		],
		update: [...(methodOverrides.update ?? []), ...defaultMethodNames.update],
		delete: [...(methodOverrides.delete ?? []), ...defaultMethodNames.delete],
	};
	const resolveMethods = {
		create: createSdkMethodResolver(methodNames.create),
		list: createSdkMethodResolver(methodNames.list),
		getById: createSdkMethodResolver(methodNames.getById),
		update: createSdkMethodResolver(methodNames.update),
		delete: createSdkMethodResolver(methodNames.delete),
	};

	return {
		async create(options: unknown): Promise<FlattenedResponse<T>> {
			const result = await resolveMethods.create()(
				mergeSdkOptions(sdkOptions, options),
			);
			return (await transformResponse(result)) as FlattenedResponse<T>;
		},

		async list(options: unknown): Promise<ListResult<T>> {
			const result = await resolveMethods.list()(
				mergeSdkOptions(sdkOptions, options),
			);
			return normalizeListResult<T>(await transformResponse(result));
		},

		async getById(options: unknown): Promise<CrudResult<T>> {
			const result = await resolveMethods.getById()(
				mergeSdkOptions(sdkOptions, options),
			);
			return (await transformResponse(result)) as CrudResult<T>;
		},

		async update(options: unknown): Promise<CrudResult<T>> {
			const result = await resolveMethods.update()(
				mergeSdkOptions(sdkOptions, options),
			);
			return (await transformResponse(result)) as CrudResult<T>;
		},

		async delete(options: unknown): Promise<FlattenedResponse<boolean>> {
			const result = await resolveMethods.delete()(
				mergeSdkOptions(sdkOptions, options),
			);
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
	};
}
