/**
 * Enhanced Listmonk API client with automatic response flattening
 * Uses generated types and runtime transformation for the best developer experience
 */

import { createClient } from "../../generated/client";
import * as sdk from "../../generated/sdk.gen";
import type * as t from "../../generated/types.gen";
import { createCrudOperations, type CrudOperations } from "./crud";
import {
	type CrudResult,
	type FlattenedResponse,
	type ListResult,
	transformResponse,
} from "./response";
import {
	createHealthCheckUrl,
	createResilientFetch,
	DEFAULT_RETRIES,
	DEFAULT_TIMEOUT_MS,
	type FetchFn,
} from "./transport";

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
	list(options?: t.GetMediaData): Promise<ListResult<t.MediaFileObject>>;
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
	list(options?: {
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

type TransactionalSendParams = NonNullable<
	t.TransactWithSubscriberData["body"]
>;
type CampaignTestParams = Omit<t.TestCampaignByIdData, "url">;

// Composed operation interfaces
interface ImportOperations extends BaseGetOperation<t.ImportStatus> {
	stop(): Promise<FlattenedResponse<t.ImportStatus>>;
	logs(): Promise<FlattenedResponse<string>>;
	start(params: ImportStartParams): Promise<FlattenedResponse<t.ImportStatus>>;
}

interface BounceOperations
	extends
		BaseBounceListOperation<t.Bounce>,
		BaseGetByIdOperation<t.Bounce>,
		BaseDeleteOperation,
		BaseDeleteByIdOperation {}

interface TransactionalOperations {
	send(options: TransactionalSendParams): Promise<FlattenedResponse<boolean>>;
}

interface SettingsOperations {
	get(): Promise<FlattenedResponse<t.Settings>>;
	update(options: {
		body: Record<string, unknown>;
	}): Promise<FlattenedResponse<boolean>>;
	testSmtp(options: {
		body: Record<string, unknown>;
	}): Promise<FlattenedResponse<boolean>>;
}

interface DashboardOperations {
	getCharts(options?: {
		query?: { type?: string };
	}): Promise<FlattenedResponse<t.DashboardChart>>;
	getCounts(): Promise<FlattenedResponse<t.DashboardCount>>;
}

interface SystemOperations {
	getAbout(): Promise<FlattenedResponse<t.About>>;
	getConfig(): Promise<FlattenedResponse<t.ServerConfig>>;
	getLogs(): Promise<FlattenedResponse<string[]>>;
	reload(): Promise<FlattenedResponse<boolean>>;
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
export type About = t.About;
export type ListmonkClient = EnhancedListmonkClient;

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
	> & {
		patch(
			options: Omit<t.PatchSubscriberByIdData, "url">,
		): Promise<CrudResult<Subscriber>>;
		manageLists(options: {
			body: {
				action?: "add" | "remove" | "unsubscribe";
				target_list_ids?: number;
				query?: string;
				ids?: number[];
			};
		}): Promise<FlattenedResponse<boolean>>;
		manageListById(options: {
			path: { id: number };
			body: {
				action?: "add" | "remove" | "unsubscribe";
				target_list_ids?: number;
				query?: string;
				ids?: number[];
			};
		}): Promise<FlattenedResponse<boolean>>;
		manageBlocklist(options: {
			body: { action?: "add" | "remove"; query?: string; ids?: number[] };
		}): Promise<FlattenedResponse<boolean>>;
		manageBlocklistById(options: {
			path: { id: number };
			body: { action?: "add" | "remove" };
		}): Promise<FlattenedResponse<boolean>>;
		export(options: {
			path: { id: number };
		}): Promise<FlattenedResponse<Record<string, unknown>>>;
		sendOptin(options: {
			path: { id: number };
		}): Promise<FlattenedResponse<boolean>>;
		getBounces(options: {
			path: { id: number };
		}): Promise<FlattenedResponse<Record<string, unknown>>>;
		deleteBounces(options: {
			path: { id: number };
		}): Promise<FlattenedResponse<boolean>>;
		deleteByQuery(options: {
			body: { query?: string };
		}): Promise<FlattenedResponse<boolean>>;
		blocklistByQuery(options: {
			body: { query?: string };
		}): Promise<FlattenedResponse<boolean>>;
		manageListsByQuery(options: {
			body: {
				action?: "add" | "remove" | "unsubscribe";
				target_list_ids?: number;
				query?: string;
			};
		}): Promise<FlattenedResponse<boolean>>;
	};
	campaign: CrudOperations<
		Campaign,
		CampaignTypes["create"],
		CampaignTypes["update"],
		CampaignTypes["get"],
		CampaignTypes["getById"],
		CampaignTypes["delete"]
	> & {
		preview(options: {
			path: { id: number };
		}): Promise<FlattenedResponse<string>>;
		updatePreview(options: {
			path: { id: number };
			body: { template_id?: number; body?: string };
		}): Promise<FlattenedResponse<boolean>>;
		previewText(options: {
			path: { id: number };
			body: { template_id?: number; body?: string };
		}): Promise<FlattenedResponse<string>>;
		updateStatus(options: {
			path: { id: number };
			body: { status: "scheduled" | "running" | "paused" | "cancelled" };
		}): Promise<FlattenedResponse<boolean>>;
		updateArchive(options: {
			path: { id: number };
			body: { archive: boolean };
		}): Promise<FlattenedResponse<boolean>>;
		createContent(options: {
			path: { id: number };
			body: {
				content_type: "html" | "markdown" | "plain" | "richtext" | "visual";
				body: string;
			};
		}): Promise<FlattenedResponse<boolean>>;
		test(options: CampaignTestParams): Promise<FlattenedResponse<boolean>>;
		getRunningStats(options: {
			query: { campaign_id: number };
		}): Promise<FlattenedResponse<Record<string, unknown>>>;
		getAnalytics(options: {
			path: { type: "links" | "views" | "clicks" | "bounces" };
			query: { from: string; to: string; id: string };
		}): Promise<FlattenedResponse<Record<string, unknown>>>;
	};
	template: CrudOperations<
		t.Template,
		TemplateTypes["create"],
		TemplateTypes["update"],
		TemplateTypes["get"],
		TemplateTypes["getById"],
		TemplateTypes["delete"]
	> & {
		setAsDefault(options: {
			path: { id: number };
		}): Promise<FlattenedResponse<t.Template>>;
	};
	media: MediaOperations & {
		upload(options: {
			body: File | Blob;
		}): Promise<FlattenedResponse<t.MediaFileObject>>;
	};

	// Import operations
	import: ImportOperations;

	// Bounce operations
	bounce: BounceOperations;

	// Transactional operations
	transactional: TransactionalOperations;

	// Settings operations
	settings: SettingsOperations;

	// Dashboard operations
	dashboard: DashboardOperations;

	// System operations
	system: SystemOperations;
}

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
				timeout?: number;
				retries?: number;
		  }
		| Partial<ListmonkConfig>,
): EnhancedListmonkClient => {
	// Determine final configuration
	let finalConfig: {
		baseUrl: string;
		headers?: Record<string, string>;
		fetch?: typeof fetch;
	};
	let timeout = DEFAULT_TIMEOUT_MS;
	let retries = DEFAULT_RETRIES;

	if (!config || (!config.baseUrl && !("auth" in config))) {
		// Use environment-based configuration
		const envConfig = createConfig(config as Partial<ListmonkConfig>);
		validateConfig(envConfig);
		timeout = envConfig.timeout ?? DEFAULT_TIMEOUT_MS;
		retries = envConfig.retries ?? DEFAULT_RETRIES;
		finalConfig = {
			baseUrl: envConfig.baseUrl,
			headers: configToHeaders(envConfig),
		};
	} else if ("auth" in config) {
		// Handle ListmonkConfig format
		const fullConfig = createConfig(config);
		validateConfig(fullConfig);
		timeout = fullConfig.timeout ?? DEFAULT_TIMEOUT_MS;
		retries = fullConfig.retries ?? DEFAULT_RETRIES;
		finalConfig = {
			baseUrl: fullConfig.baseUrl,
			headers: configToHeaders(fullConfig),
		};
	} else {
		// Handle direct config format
		const directConfig = config as {
			baseUrl: string;
			headers?: Record<string, string>;
			timeout?: number;
			retries?: number;
		};
		timeout = directConfig.timeout ?? DEFAULT_TIMEOUT_MS;
		retries = directConfig.retries ?? DEFAULT_RETRIES;
		finalConfig = {
			baseUrl: directConfig.baseUrl,
			headers: directConfig.headers,
		};
	}

	const resilientFetch = createResilientFetch({
		timeoutMs: timeout,
		retries,
		baseFetch: globalThis.fetch.bind(globalThis) as FetchFn,
	}) as unknown as typeof fetch;
	finalConfig.fetch = resilientFetch;

	// Create SDK options with client configuration
	const sdkOptions = {
		client: createClient(finalConfig),
	};

	// Create enhanced client with only registered operations
	const enhancedClient: EnhancedListmonkClient = {
		// Health check
		async getHealthCheck() {
			const healthCheckUrl = createHealthCheckUrl(finalConfig.baseUrl);
			const request = new Request(healthCheckUrl, {
				method: "GET",
				headers: finalConfig.headers,
			});
			const response = await resilientFetch(request);

			if (!response.ok) {
				let message = `Health check failed with status ${response.status}`;
				try {
					const payload = (await response.clone().json()) as {
						message?: string;
					};
					if (
						typeof payload.message === "string" &&
						payload.message.length > 0
					) {
						message = payload.message;
					}
				} catch {
					// Keep the default status-based message.
				}
				throw new Error(message);
			}

			let payload: unknown = false;
			try {
				payload = await response.json();
			} catch {
				// Treat a non-JSON success body as an unhealthy response.
			}
			return (await transformResponse({
				data: payload,
				request,
				response,
			})) as FlattenedResponse<boolean>;
		},

		// Namespaced resource operations
		list: createCrudOperations("List", sdkOptions),
		subscriber: {
			...createCrudOperations("Subscriber", sdkOptions),
			async patch(options: Omit<t.PatchSubscriberByIdData, "url">) {
				const mergedOptions = { ...sdkOptions, ...options };
				const result = await sdk.patchSubscriberById(mergedOptions);
				return (await transformResponse(result)) as CrudResult<Subscriber>;
			},
			async manageLists(options: {
				body: {
					action?: "add" | "remove" | "unsubscribe";
					target_list_ids?: number;
					query?: string;
					ids?: number[];
				};
			}) {
				const mergedOptions = { ...sdkOptions, ...options };
				const result = await sdk.manageSubscriberLists(mergedOptions);
				return (await transformResponse(result)) as FlattenedResponse<boolean>;
			},
			async manageListById(options: {
				path: { id: number };
				body: {
					action?: "add" | "remove" | "unsubscribe";
					target_list_ids?: number;
					query?: string;
					ids?: number[];
				};
			}) {
				const mergedOptions = { ...sdkOptions, ...options };
				const result = await sdk.manageSubscriberListById(mergedOptions);
				return (await transformResponse(result)) as FlattenedResponse<boolean>;
			},
			async manageBlocklist(options: {
				body: { action?: "add" | "remove"; query?: string; ids?: number[] };
			}) {
				const mergedOptions = { ...sdkOptions, ...options };
				const result = await sdk.manageBlocklistBySubscriberList(mergedOptions);
				return (await transformResponse(result)) as FlattenedResponse<boolean>;
			},
			async manageBlocklistById(options: {
				path: { id: number };
				body: { action?: "add" | "remove" };
			}) {
				const mergedOptions = { ...sdkOptions, ...options };
				const result = await sdk.manageBlocklistSubscribersById(mergedOptions);
				return (await transformResponse(result)) as FlattenedResponse<boolean>;
			},
			async export(options: { path: { id: number } }) {
				const mergedOptions = { ...sdkOptions, ...options };
				const result = await sdk.exportSubscriberDataById(mergedOptions);
				return (await transformResponse(result)) as FlattenedResponse<
					Record<string, unknown>
				>;
			},
			async sendOptin(options: { path: { id: number } }) {
				const mergedOptions = { ...sdkOptions, ...options };
				const result = await sdk.subscriberSendOptinById(mergedOptions);
				return (await transformResponse(result)) as FlattenedResponse<boolean>;
			},
			async getBounces(options: { path: { id: number } }) {
				const mergedOptions = { ...sdkOptions, ...options };
				const result = await sdk.getSubscriberBouncesById(mergedOptions);
				return (await transformResponse(result)) as FlattenedResponse<
					Record<string, unknown>
				>;
			},
			async deleteBounces(options: { path: { id: number } }) {
				const mergedOptions = { ...sdkOptions, ...options };
				const result = await sdk.deleteSubscriberBouncesById(mergedOptions);
				return (await transformResponse(result)) as FlattenedResponse<boolean>;
			},
			async deleteByQuery(options: { body: { query?: string } }) {
				const mergedOptions = { ...sdkOptions, ...options };
				const result = await sdk.deleteSubscriberByQuery(mergedOptions);
				return (await transformResponse(result)) as FlattenedResponse<boolean>;
			},
			async blocklistByQuery(options: { body: { query?: string } }) {
				const mergedOptions = { ...sdkOptions, ...options };
				const result = await sdk.blocklistSubscribersQuery(mergedOptions);
				return (await transformResponse(result)) as FlattenedResponse<boolean>;
			},
			async manageListsByQuery(options: {
				body: {
					action?: "add" | "remove" | "unsubscribe";
					target_list_ids?: number;
					query?: string;
				};
			}) {
				const mergedOptions = { ...sdkOptions, ...options };
				const result = await sdk.manageSubscriberListsByQuery(mergedOptions);
				return (await transformResponse(result)) as FlattenedResponse<boolean>;
			},
		},
		campaign: {
			...createCrudOperations("Campaign", sdkOptions),
			async preview(options: { path: { id: number } }) {
				const mergedOptions = { ...sdkOptions, ...options };
				const result = await sdk.previewCampaignById(mergedOptions);
				return (await transformResponse(result)) as FlattenedResponse<string>;
			},
			async updatePreview(options: {
				path: { id: number };
				body: { template_id?: number; body?: string };
			}) {
				const mergedOptions = { ...sdkOptions, ...options };
				const result = await sdk.updatePreviewCampaignById(mergedOptions);
				return (await transformResponse(result)) as FlattenedResponse<boolean>;
			},
			async previewText(options: {
				path: { id: number };
				body: { template_id?: number; body?: string };
			}) {
				const mergedOptions = { ...sdkOptions, ...options };
				const result = await sdk.previewCampaignTextById(mergedOptions);
				return (await transformResponse(result)) as FlattenedResponse<string>;
			},
			async updateStatus(options: {
				path: { id: number };
				body: { status: "scheduled" | "running" | "paused" | "cancelled" };
			}) {
				const mergedOptions = { ...sdkOptions, ...options };
				const result = await sdk.updateCampaignStatusById(mergedOptions);
				return (await transformResponse(result)) as FlattenedResponse<boolean>;
			},
			async updateArchive(options: {
				path: { id: number };
				body: { archive: boolean };
			}) {
				const mergedOptions = { ...sdkOptions, ...options };
				const result = await sdk.updateCampaignArchiveById(mergedOptions);
				return (await transformResponse(result)) as FlattenedResponse<boolean>;
			},
			async createContent(options: {
				path: { id: number };
				body: {
					content_type: "html" | "markdown" | "plain" | "richtext" | "visual";
					body: string;
				};
			}) {
				const mergedOptions = { ...sdkOptions, ...options };
				const result = await sdk.createCampaignContentById(mergedOptions);
				return (await transformResponse(result)) as FlattenedResponse<boolean>;
			},
			async test(options: CampaignTestParams) {
				const mergedOptions = { ...sdkOptions, ...options };
				const result = await sdk.testCampaignById(mergedOptions);
				return (await transformResponse(result)) as FlattenedResponse<boolean>;
			},
			async getRunningStats(options: { query: { campaign_id: number } }) {
				const mergedOptions = { ...sdkOptions, ...options };
				const result = await sdk.getRunningCampaignStats(mergedOptions);
				return (await transformResponse(result)) as FlattenedResponse<
					Record<string, unknown>
				>;
			},
			async getAnalytics(options: {
				path: { type: "links" | "views" | "clicks" | "bounces" };
				query: { from: string; to: string; id: string };
			}) {
				const mergedOptions = { ...sdkOptions, ...options };
				const result = await sdk.getCampaignAnalytics(mergedOptions);
				return (await transformResponse(result)) as FlattenedResponse<
					Record<string, unknown>
				>;
			},
		},
		template: {
			...createCrudOperations("Template", sdkOptions),
			async setAsDefault(options: { path: { id: number } }) {
				const mergedOptions = { ...sdkOptions, ...options };
				const result = await sdk.setDefaultTemplateById(mergedOptions);
				return (await transformResponse(
					result,
				)) as FlattenedResponse<t.Template>;
			},
		},
		media: {
			list: createCrudOperations("Media", sdkOptions)
				.list as MediaOperations["list"],
			getById: createCrudOperations("Media", sdkOptions)
				.getById as MediaOperations["getById"],
			deleteById: createCrudOperations("Media", sdkOptions)
				.delete as MediaOperations["deleteById"], // Media uses deleteById, not delete
			async upload(options: { body: File | Blob }) {
				const mergedOptions = { ...sdkOptions, ...options };
				const result = await sdk.uploadMedia(mergedOptions);
				return (await transformResponse(
					result,
				)) as FlattenedResponse<t.MediaFileObject>;
			},
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
			async list(options?: {
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

		// Settings operations
		settings: {
			async get() {
				const result = await sdk.getSettings(sdkOptions);
				return (await transformResponse(
					result,
				)) as FlattenedResponse<t.Settings>;
			},
			async update(options: { body: Record<string, unknown> }) {
				const mergedOptions = { ...sdkOptions, ...options };
				const result = await sdk.updateSettings(mergedOptions);
				return (await transformResponse(result)) as FlattenedResponse<boolean>;
			},
			async testSmtp(options: { body: Record<string, unknown> }) {
				const mergedOptions = { ...sdkOptions, ...options };
				const result = await sdk.testSmtpSettings(mergedOptions);
				return (await transformResponse(result)) as FlattenedResponse<boolean>;
			},
		},

		// Dashboard operations
		dashboard: {
			async getCharts(options?: { query?: { type?: string } }) {
				const mergedOptions = options
					? { ...sdkOptions, ...options }
					: sdkOptions;
				const result = await sdk.getDashboardCharts(mergedOptions);
				return (await transformResponse(
					result,
				)) as FlattenedResponse<t.DashboardChart>;
			},
			async getCounts() {
				const result = await sdk.getDashboardCounts(sdkOptions);
				return (await transformResponse(
					result,
				)) as FlattenedResponse<t.DashboardCount>;
			},
		},

		// System operations
		system: {
			async getAbout() {
				const result = await sdk.getAboutInfo(sdkOptions);
				return (await transformResponse(result)) as FlattenedResponse<t.About>;
			},
			async getConfig() {
				const result = await sdk.getServerConfig(sdkOptions);
				return (await transformResponse(
					result,
				)) as FlattenedResponse<t.ServerConfig>;
			},
			async getLogs() {
				const result = await sdk.getLogs(sdkOptions);
				return (await transformResponse(result)) as FlattenedResponse<string[]>;
			},
			async reload() {
				const result = await sdk.reloadApp(sdkOptions);
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
export { transformResponse } from "./response";
