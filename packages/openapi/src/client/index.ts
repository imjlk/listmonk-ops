/**
 * Enhanced Listmonk API client with automatic response flattening
 * Uses generated types and runtime transformation for the best developer experience
 */

import { createClient } from "../../generated/client";
import * as sdk from "../../generated/sdk.gen";
import type * as types from "../../generated/types.gen";
import {
	configToHeaders,
	createConfig,
	type ListmonkConfig,
	validateConfig,
} from "../config";

// Re-export convenience types
export type List = types.List;
export type Subscriber = types.Subscriber;
export type Campaign = types.Campaign;

/**
 * Flattened response type for easier development
 */
type FlattenedResponse<T> = {
	data: T;
	request: Request;
	response: Response;
};

/**
 * Enhanced client interface with proper type definitions for common operations
 */
interface EnhancedListmonkClient extends ReturnType<typeof createClient> {
	// Health check
	getHealthCheck(): Promise<FlattenedResponse<boolean>>;

	// Lists
	createList(options: {
		body: {
			name: string;
			type: "public" | "private";
			optin: "single" | "double";
		};
	}): Promise<FlattenedResponse<List>>;
	getListById(options: {
		path: { list_id: number };
	}): Promise<FlattenedResponse<List> | { error: unknown }>;
	deleteListById(options: {
		path: { list_id: number };
	}): Promise<FlattenedResponse<boolean>>;
	getLists(options?: {
		query?: {
			page?: number;
			per_page?: number;
			order_by?: string;
			order?: string;
			query?: string;
		};
	}): Promise<
		FlattenedResponse<{
			results: List[];
			total: number;
			per_page: number;
			page: number;
		}>
	>;

	// Subscribers
	getSubscribers(options?: {
		query?: {
			page?: number;
			per_page?: number;
			order_by?: string;
			order?: string;
			query?: string;
		};
	}): Promise<
		FlattenedResponse<{
			results: Subscriber[];
			total: number;
			per_page: number;
			page: number;
		}>
	>;
	createSubscriber(options: {
		body: {
			email: string;
			name?: string;
			status?: "enabled" | "disabled";
			lists?: number[];
			attributes?: Record<string, unknown>;
		};
	}): Promise<FlattenedResponse<Subscriber>>;
	getSubscriberById(options: {
		path: { subscriber_id: number };
	}): Promise<FlattenedResponse<Subscriber> | { error: unknown }>;
	deleteSubscriberById(options: {
		path: { subscriber_id: number };
	}): Promise<FlattenedResponse<boolean>>;

	// Campaigns
	getCampaigns(options?: {
		query?: {
			page?: number;
			per_page?: number;
			order_by?: string;
			order?: string;
			query?: string;
			status?: string[];
		};
	}): Promise<
		FlattenedResponse<{
			results: Campaign[];
			total: number;
			per_page: number;
			page: number;
		}>
	>;
	createCampaign(options: {
		body: {
			name: string;
			subject: string;
			lists: number[];
			type?: "regular" | "optin";
			content_type?: "richtext" | "html" | "markdown" | "plain";
			body?: string;
			alt_body?: string;
			send_at?: string;
			tags?: string[];
		};
	}): Promise<FlattenedResponse<Campaign>>;
	getCampaignById(options: {
		path: { campaign_id: number };
	}): Promise<FlattenedResponse<Campaign> | { error: unknown }>;
	deleteCampaignById(options: {
		path: { campaign_id: number };
	}): Promise<FlattenedResponse<boolean>>;

	// All other SDK methods (fallback to original types)
	[K: string]: unknown;
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
export const createListmonkClient = (config: {
	baseUrl: string;
	headers?: Record<string, string>;
}): EnhancedListmonkClient => {
	// Create SDK options with client configuration
	const sdkOptions = {
		client: createClient(config)
	};

	// Create proxy to automatically transform responses and provide SDK methods
	const enhancedClient = new Proxy(sdkOptions.client, {
		get(target, prop, receiver) {
			// First check if it's an SDK method
			if (typeof prop === 'string' && prop in sdk) {
				const sdkMethod = (sdk as Record<string, unknown>)[prop];
				if (typeof sdkMethod === 'function') {
					return async (...args: unknown[]) => {
						const firstArg = args[0];
						const options = typeof firstArg === 'object' && firstArg !== null
							? { ...sdkOptions, ...firstArg }
							: sdkOptions;
						const result = await sdkMethod(options);
						return transformResponse(result);
					};
				}
			}

			// Otherwise, return the original HTTP client method
			const originalMethod = Reflect.get(target, prop, receiver);
			if (typeof originalMethod === "function") {
				return async (...args: unknown[]) => {
					const result = await originalMethod.apply(target, args);
					return transformResponse(result);
				};
			}

			return originalMethod;
		},
	}) as EnhancedListmonkClient;

	return enhancedClient;
};

/**
 * Creates a Listmonk client with environment-based configuration
 *
 * @param overrides - Optional configuration overrides
 * @returns Enhanced Listmonk client
 */
export const createListmonkClientFromEnv = (
	overrides?: Partial<ListmonkConfig>,
): EnhancedListmonkClient => {
	const config = createConfig(overrides);
	validateConfig(config);

	return createListmonkClient({
		baseUrl: config.baseUrl,
		headers: configToHeaders(config),
	});
};

/**
 * Raw SDK export for advanced use cases
 */
export const rawSdk = sdk;

/**
 * Create raw client without response transformation
 */
export { createClient };
