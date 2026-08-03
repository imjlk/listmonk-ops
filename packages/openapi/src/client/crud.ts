import type { createClient } from "../../generated/client";
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
type SdkMethod = (options: unknown) => Promise<unknown>;

/**
 * Maps a CRUD method name to the concrete generated SDK function it should
 * invoke. Callers pass the resolved function directly so unused SDK functions
 * stay tree-shakeable and there is no dynamic property lookup on the SDK
 * namespace.
 */
export type CrudMethodResolvers = Record<CrudMethod, SdkMethod>;

function mergeSdkOptions(
	sdkOptions: SdkOptions,
	options: unknown,
): unknown {
	return typeof options === "object" && options !== null
		? { ...sdkOptions, ...(options as Record<string, unknown>) }
		: sdkOptions;
}

export function createCrudOperations<T>(
	resolvers: CrudMethodResolvers,
	sdkOptions: SdkOptions,
): CrudOperations<T, unknown, unknown, unknown, unknown, unknown> {
	return {
		async create(options: unknown): Promise<FlattenedResponse<T>> {
			const result = await resolvers.create(
				mergeSdkOptions(sdkOptions, options),
			);
			return (await transformResponse(result)) as FlattenedResponse<T>;
		},

		async list(options: unknown): Promise<ListResult<T>> {
			const result = await resolvers.list(
				mergeSdkOptions(sdkOptions, options),
			);
			return normalizeListResult<T>(await transformResponse(result));
		},

		async getById(options: unknown): Promise<CrudResult<T>> {
			const result = await resolvers.getById(
				mergeSdkOptions(sdkOptions, options),
			);
			return (await transformResponse(result)) as CrudResult<T>;
		},

		async update(options: unknown): Promise<CrudResult<T>> {
			const result = await resolvers.update(
				mergeSdkOptions(sdkOptions, options),
			);
			return (await transformResponse(result)) as CrudResult<T>;
		},

		async delete(options: unknown): Promise<FlattenedResponse<boolean>> {
			const result = await resolvers.delete(
				mergeSdkOptions(sdkOptions, options),
			);
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
	};
}

/**
 * Returns a SDK method that throws when the resource does not expose a
 * generated function for the given CRUD slot. Preserves the lazy-failure
 * behavior of the previous dynamic dispatcher without pinning the whole SDK
 * namespace into the bundle.
 */
export function unsupportedCrudMethod(
	resourceName: string,
	method: CrudMethod,
): SdkMethod {
	return () => {
		throw new Error(
			`SDK method not found: ${method} for resource ${resourceName}`,
		);
	};
}

/**
 * Adapts a directly-imported generated SDK function so it satisfies the
 * `SdkMethod` contract without losing the static call edge that lets bundlers
 * drop unused SDK functions. Generated functions accept narrower option types
 * than `unknown`; `createCrudOperations` merges typed options at the call site.
 */
export function staticSdkMethod<T extends (...args: never[]) => Promise<unknown>>(
	method: T,
): SdkMethod {
	return method as unknown as SdkMethod;
}
