/**
 * Enhanced Listmonk API client with automatic response flattening
 * Uses generated types and runtime transformation for the best developer experience
 */

import { createClient } from "../../generated/client";
import * as sdk from "../../generated/sdk.gen";
import type * as t from "../../generated/types.gen";

// Clean types by removing common unnecessary fields
type GetData<T> = Omit<T, "url" | "body" | "path">;
type GetByIdData<T> = Omit<T, "url" | "body" | "query">;
type CreateData<T> = Omit<T, "url" | "path" | "query">;
type UpdateData<T> = Omit<T, "url" | "query">;
type DeleteData<T> = Omit<T, "url" | "body" | "query">;

// Helper type to generate clean types for a resource
type ResourceTypes<TCreate, TGet, TGetById, TUpdate, TDelete> = {
	create: CreateData<TCreate>;
	get: GetData<TGet>;
	getById: GetByIdData<TGetById>;
	update: UpdateData<TUpdate>;
	delete: DeleteData<TDelete>;
};

// Resource-specific clean types with overrides for special cases
type ListTypes = ResourceTypes<
	t.CreateListData,
	t.GetListsData,
	t.GetListByIdData,
	t.UpdateListByIdData,
	t.DeleteListByIdData
>;

type CampaignTypes = ResourceTypes<
	t.CreateCampaignData,
	t.GetCampaignsData,
	t.GetCampaignByIdData,
	t.UpdateCampaignByIdData,
	t.DeleteCampaignByIdData
>;

type SubscriberTypes = ResourceTypes<
	t.CreateSubscriberData,
	t.GetSubscribersData,
	t.GetSubscriberByIdData,
	t.UpdateSubscriberByIdData,
	t.DeleteSubscriberByIdData
>;

type TemplateTypes = ResourceTypes<
	t.CreateTemplateData,
	t.GetTemplatesData,
	t.GetTemplateByIdData,
	t.UpdateTemplateByIdData,
	t.DeleteTemplateByIdData
>;

// Media operations interface - media doesn't follow standard patterns
interface MediaOperations {
	get(options?: t.GetMediaData): Promise<ListResult<t.MediaFileObject>>;
	getById(options: {
		path: { id: number };
	}): Promise<CrudResult<t.MediaFileObject>>;
	deleteById(options: {
		path: { id: number };
	}): Promise<FlattenedResponse<boolean>>;
}

// Base operation interfaces for reuse
interface BaseGetOperation<T> {
	get(): Promise<FlattenedResponse<T>>;
}

interface BaseGetByIdOperation<T> {
	getById(options: { path: { id: number } }): Promise<CrudResult<T>>;
}

interface BaseDeleteOperation {
	delete(options: {
		query: { all?: boolean; id?: string };
	}): Promise<FlattenedResponse<boolean>>;
}

interface BaseDeleteByIdOperation {
	deleteById(options: {
		path: { id: number };
	}): Promise<FlattenedResponse<boolean>>;
}

interface BaseBounceListOperation<T> {
	get(options?: {
		campaign_id?: number;
		page?: number;
		per_page?: number | "all";
		source?: string;
		order_by?: "email" | "campaign_name" | "source" | "created_at";
		order?: "asc" | "desc";
	}): Promise<ListResult<T>>;
}

// Specific operation types
type ImportStartParams = {
	mode: "subscribe" | "blocklist";
	delim: string;
	lists: number[];
	overwrite: boolean;
	subscription_status?: string;
	file: File | Blob;
};

type TransactionalSendParams = {
	subscriber_email?: string;
	subscriber_id?: number;
	subscriber_emails?: string[];
	subscriber_ids?: number[];
	template_id: number;
	from_email?: string;
	data?: Record<string, unknown>;
	headers?: Record<string, string>[];
	messenger?: string;
	content_type?: "html" | "markdown" | "plain";
};

// Composed operation interfaces
interface ImportOperations extends BaseGetOperation<t.ImportStatus> {
	stop(): Promise<FlattenedResponse<t.ImportStatus>>;
	logs(): Promise<FlattenedResponse<string>>;
	start(params: ImportStartParams): Promise<FlattenedResponse<t.ImportStatus>>;
}

interface BounceOperations
	extends BaseBounceListOperation<t.Bounce>,
		BaseGetByIdOperation<t.Bounce>,
		BaseDeleteOperation,
		BaseDeleteByIdOperation {}

interface TransactionalOperations {
	send(options: TransactionalSendParams): Promise<FlattenedResponse<boolean>>;
}

import {
	configToHeaders,
	createConfig,
	type ListmonkConfig,
	validateConfig,
} from "../config";

// Re-export convenience types
export type List = t.List;
export type Subscriber = t.Subscriber;
export type Campaign = t.Campaign;
export type Template = t.Template;
export type ListmonkClient = EnhancedListmonkClient;

/**
 * Flattened response type for easier development
 */
type FlattenedResponse<T> = {
	data: T;
	request: Request;
	response: Response;
};

/**
 * Generic CRUD operation types
 */
type CrudResult<T> = FlattenedResponse<T> | { error: unknown };
type ListResult<T> = FlattenedResponse<{
	results: T[];
	total: number;
	per_page: number;
	page: number;
}>;

/**
 * Generic CRUD interface for resources
 */
interface CrudOperations<
	T,
	CreateData,
	UpdateData,
	GetData,
	GetByIdData,
	DeleteData,
> {
	create(options: CreateData): Promise<FlattenedResponse<T>>;
	get(options?: GetData): Promise<ListResult<T>>;
	getById(options: GetByIdData): Promise<CrudResult<T>>;
	update(options: UpdateData): Promise<CrudResult<T>>;
	delete(options: DeleteData): Promise<FlattenedResponse<boolean>>;
}

/**
 * Enhanced client interface with only registered namespaces and operations
 */
interface EnhancedListmonkClient {
	// Health check
	getHealthCheck(): Promise<FlattenedResponse<boolean>>;

	// Namespaced resource operations
	list: CrudOperations<
		List,
		ListTypes["create"],
		ListTypes["update"],
		ListTypes["get"],
		ListTypes["getById"],
		ListTypes["delete"]
	>;
	subscriber: CrudOperations<
		Subscriber,
		SubscriberTypes["create"],
		SubscriberTypes["update"],
		SubscriberTypes["get"],
		SubscriberTypes["getById"],
		SubscriberTypes["delete"]
	>;
	campaign: CrudOperations<
		Campaign,
		CampaignTypes["create"],
		CampaignTypes["update"],
		CampaignTypes["get"],
		CampaignTypes["getById"],
		CampaignTypes["delete"]
	>;
	template: CrudOperations<
		t.Template,
		TemplateTypes["create"],
		TemplateTypes["update"],
		TemplateTypes["get"],
		TemplateTypes["getById"],
		TemplateTypes["delete"]
	> & {
		setAsDefault(options: { path: { id: number } }): Promise<FlattenedResponse<boolean>>;
	};
	media: MediaOperations;

	// Import operations
	import: ImportOperations;

	// Bounce operations
	bounce: BounceOperations;

	// Transactional operations
	transactional: TransactionalOperations;
}

/**
 * Recursively flattens nested data structures
 * Specifically handles Listmonk's data.data.data... patterns
 */
const flattenData = (obj: unknown): unknown => {
	if (!obj || typeof obj !== "object") return obj;

	const objRecord = obj as Record<string, unknown>;

	// If object has a 'data' property that contains another object with 'data'
	if (
		objRecord.data &&
		typeof objRecord.data === "object" &&
		objRecord.data !== null
	) {
		const dataRecord = objRecord.data as Record<string, unknown>;
		if ("data" in dataRecord) {
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
				if (key !== "data" && key !== "message") {
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
export const transformResponse = async (
	response: unknown,
): Promise<unknown> => {
	if (!response || typeof response !== "object") return response;
	return flattenData(response);
};

/**
 * Creates a Listmonk client with automatic response flattening
 *
 * @param config - Client configuration
 * @returns Enhanced Listmonk client with flattened responses
 *
 * @example
 * ```typescript
 * const client = createListmonkClient({
 *   baseUrl: 'http://localhost:9000/api',
 *   headers: {
 *     Authorization: 'token api-admin:your-token'
 *   }
 * });
 *
 * // All responses are automatically flattened
 * const health = await client.getHealthCheck();
 * console.log(health.data); // boolean, not nested
 * ```
 */
/**
 * Create a CRUD operations object for a specific resource
 */
const createCrudOperations = <T>(
	resourceName: string,
	sdkOptions: { client: ReturnType<typeof createClient> },
): CrudOperations<T, unknown, unknown, unknown, unknown, unknown> => {
	// Map resource names to actual SDK method names
	const methodNames = {
		create: `create${resourceName}`,
		get: `get${resourceName}s`,
		getById: `get${resourceName}ById`,
		update: `update${resourceName}ById`,
		delete: `delete${resourceName}ById`,
	};

	return {
		async create(options: unknown): Promise<FlattenedResponse<T>> {
			const sdkMethod = (sdk as Record<string, unknown>)[methodNames.create];
			if (typeof sdkMethod === "function") {
				const mergedOptions =
					typeof options === "object" && options !== null
						? { ...sdkOptions, ...options }
						: sdkOptions;
				const result = await sdkMethod(mergedOptions);
				return (await transformResponse(result)) as FlattenedResponse<T>;
			}
			throw new Error(`${methodNames.create} method not found`);
		},

		async get(options: unknown): Promise<ListResult<T>> {
			const sdkMethod = (sdk as Record<string, unknown>)[methodNames.get];
			if (typeof sdkMethod === "function") {
				const mergedOptions =
					typeof options === "object" && options !== null
						? { ...sdkOptions, ...options }
						: sdkOptions;
				const result = await sdkMethod(mergedOptions);
				return (await transformResponse(result)) as ListResult<T>;
			}
			throw new Error(`${methodNames.get} method not found`);
		},

		async getById(options: unknown): Promise<CrudResult<T>> {
			const sdkMethod = (sdk as Record<string, unknown>)[methodNames.getById];
			if (typeof sdkMethod === "function") {
				const mergedOptions =
					typeof options === "object" && options !== null
						? { ...sdkOptions, ...options }
						: sdkOptions;
				const result = await sdkMethod(mergedOptions);
				return (await transformResponse(result)) as CrudResult<T>;
			}
			throw new Error(`${methodNames.getById} method not found`);
		},

		async update(options: unknown): Promise<CrudResult<T>> {
			const sdkMethod = (sdk as Record<string, unknown>)[methodNames.update];
			if (typeof sdkMethod === "function") {
				const mergedOptions =
					typeof options === "object" && options !== null
						? { ...sdkOptions, ...options }
						: sdkOptions;
				const result = await sdkMethod(mergedOptions);
				return (await transformResponse(result)) as CrudResult<T>;
			}
			throw new Error(`${methodNames.update} method not found`);
		},

		async delete(options: unknown): Promise<FlattenedResponse<boolean>> {
			const sdkMethod = (sdk as Record<string, unknown>)[methodNames.delete];
			if (typeof sdkMethod === "function") {
				const mergedOptions =
					typeof options === "object" && options !== null
						? { ...sdkOptions, ...options }
						: sdkOptions;
				const result = await sdkMethod(mergedOptions);
				return (await transformResponse(result)) as FlattenedResponse<boolean>;
			}
			throw new Error(`${methodNames.delete} method not found`);
		},
	};
};

/**
 * Creates a Listmonk client with automatic response flattening
 *
 * @param config - Client configuration (optional, uses environment variables if not provided)
 * @returns Enhanced Listmonk client with flattened responses
 *
 * @example
 * ```typescript
 * // Using environment variables
 * const client = createListmonkClient();
 *
 * // Using explicit configuration
 * const client = createListmonkClient({
 *   baseUrl: 'http://localhost:9000/api',
 *   headers: {
 *     Authorization: 'token api-admin:your-token'
 *   }
 * });
 *
 * // All responses are automatically flattened
 * const health = await client.getHealthCheck();
 * console.log(health.data); // boolean, not nested
 * ```
 */
export const createListmonkClient = (
	config?:
		| {
				baseUrl?: string;
				headers?: Record<string, string>;
		  }
		| Partial<ListmonkConfig>,
): EnhancedListmonkClient => {
	// Determine final configuration
	let finalConfig: { baseUrl: string; headers?: Record<string, string> };

	if (!config || (!config.baseUrl && !("auth" in config))) {
		// Use environment-based configuration
		const envConfig = createConfig(config as Partial<ListmonkConfig>);
		validateConfig(envConfig);
		finalConfig = {
			baseUrl: envConfig.baseUrl,
			headers: configToHeaders(envConfig),
		};
	} else if ("auth" in config) {
		// Handle ListmonkConfig format
		const fullConfig = createConfig(config);
		validateConfig(fullConfig);
		finalConfig = {
			baseUrl: fullConfig.baseUrl,
			headers: configToHeaders(fullConfig),
		};
	} else {
		// Handle direct config format
		finalConfig = config as {
			baseUrl: string;
			headers?: Record<string, string>;
		};
	}

	// Create SDK options with client configuration
	const sdkOptions = {
		client: createClient(finalConfig),
	};

	// Create enhanced client with only registered operations
	const enhancedClient: EnhancedListmonkClient = {
		// Health check
		async getHealthCheck() {
			const result = await sdk.getHealthCheck(sdkOptions);
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},

		// Namespaced resource operations
		list: createCrudOperations("List", sdkOptions),
		subscriber: createCrudOperations("Subscriber", sdkOptions),
		campaign: createCrudOperations("Campaign", sdkOptions),
		template: {
			...createCrudOperations("Template", sdkOptions),
			async setAsDefault(options: { path: { id: number } }) {
				const mergedOptions = { ...sdkOptions, ...options };
				const result = await sdk.updateTemplateById2(mergedOptions);
				return (await transformResponse(result)) as FlattenedResponse<boolean>;
			},
		},
		media: {
			get: createCrudOperations("Media", sdkOptions)
				.get as MediaOperations["get"],
			getById: createCrudOperations("Media", sdkOptions)
				.getById as MediaOperations["getById"],
			deleteById: createCrudOperations("Media", sdkOptions)
				.delete as MediaOperations["deleteById"], // Media uses deleteById, not delete
		},

		// Import operations
		import: {
			async get() {
				const result = await sdk.getImportSubscribers(sdkOptions);
				return (await transformResponse(
					result,
				)) as FlattenedResponse<t.ImportStatus>;
			},
			async stop() {
				const result = await sdk.stopImportSubscribers(sdkOptions);
				return (await transformResponse(
					result,
				)) as FlattenedResponse<t.ImportStatus>;
			},
			async logs() {
				const result = await sdk.getImportSubscriberLogs(sdkOptions);
				return (await transformResponse(result)) as FlattenedResponse<string>;
			},
			async start(params: ImportStartParams) {
				// Create the import payload
				const importParams = {
					mode: params.mode,
					delim: params.delim,
					lists: params.lists,
					overwrite: params.overwrite,
					...(params.subscription_status && {
						subscription_status: params.subscription_status,
					}),
				};

				const result = await sdk.importSubscribers({
					...sdkOptions,
					body: {
						params: JSON.stringify(importParams),
						file: params.file,
					},
				});
				return (await transformResponse(
					result,
				)) as FlattenedResponse<t.ImportStatus>;
			},
		},

		// Bounce operations
		bounce: {
			async get(options?: {
				campaign_id?: number;
				page?: number;
				per_page?: number | "all";
				source?: string;
				order_by?: "email" | "campaign_name" | "source" | "created_at";
				order?: "asc" | "desc";
			}) {
				const mergedOptions = options
					? { ...sdkOptions, query: options }
					: sdkOptions;
				const result = await sdk.getBounces(mergedOptions);
				return (await transformResponse(result)) as ListResult<t.Bounce>;
			},
			async getById(options: { path: { id: number } }) {
				const mergedOptions = { ...sdkOptions, ...options };
				const result = await sdk.getBounceById(mergedOptions);
				return (await transformResponse(result)) as CrudResult<t.Bounce>;
			},
			async delete(options: { query: { all?: boolean; id?: string } }) {
				const mergedOptions = { ...sdkOptions, ...options };
				const result = await sdk.deleteBounces(mergedOptions);
				return (await transformResponse(result)) as FlattenedResponse<boolean>;
			},
			async deleteById(options: { path: { id: number } }) {
				const mergedOptions = { ...sdkOptions, ...options };
				const result = await sdk.deleteBounceById(mergedOptions);
				return (await transformResponse(result)) as FlattenedResponse<boolean>;
			},
		},

		// Transactional operations
		transactional: {
			async send(options: TransactionalSendParams) {
				const mergedOptions = { ...sdkOptions, body: options };
				const result = await sdk.transactWithSubscriber(mergedOptions);
				return (await transformResponse(result)) as FlattenedResponse<boolean>;
			},
		},
	};

	return enhancedClient;
};

/**
 * @deprecated Use createListmonkClient() instead. This function will be removed in a future version.
 */
export const createListmonkClientFromEnv = (
	overrides?: Partial<ListmonkConfig>,
): EnhancedListmonkClient => {
	return createListmonkClient(overrides);
};

/**
 * Raw SDK export for advanced use cases
 */
export const rawSdk = sdk;

/**
 * Create raw client without response transformation
 */
export { createClient };
