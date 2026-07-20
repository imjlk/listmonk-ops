import { createClient } from "../../generated/client";
import * as sdk from "../../generated/sdk.gen";
import {
	configToHeaders,
	createConfig,
	type ListmonkConfig,
	validateConfig,
} from "../config";
import type {
	DirectListmonkClientConfig,
	EnhancedListmonkClient,
	ListmonkClientOptions,
} from "./contracts";
import type { SdkOptions } from "./crud";
import {
	createCampaignOperations,
	createListOperations,
	createMediaOperations,
	createSubscriberOperations,
	createTemplateOperations,
} from "./resource-operations";
import type { FlattenedResponse } from "./response";
import { transformResponse } from "./response";
import {
	createBounceOperations,
	createDashboardOperations,
	createImportOperations,
	createSettingsOperations,
	createSystemOperations,
	createTransactionalOperations,
} from "./service-operations";
import {
	createHealthCheckUrl,
	createResilientFetch,
	DEFAULT_RETRIES,
	DEFAULT_TIMEOUT_MS,
	type FetchFn,
} from "./transport";

interface ResolvedClientConfiguration {
	baseUrl: string;
	headers?: Record<string, string>;
	timeout: number;
	retries: number;
}

function createResolvedClientConfiguration(options: {
	baseUrl: string;
	headers?: Record<string, string>;
	timeout?: number;
	retries?: number;
}): ResolvedClientConfiguration {
	return {
		baseUrl: options.baseUrl,
		headers: options.headers,
		timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
		retries: options.retries ?? DEFAULT_RETRIES,
	};
}

export function resolveListmonkClientConfig(
	config?: ListmonkClientOptions,
): ResolvedClientConfiguration {
	if (!config || (!config.baseUrl && !("auth" in config))) {
		const envConfig = createConfig(config as Partial<ListmonkConfig>);
		validateConfig(envConfig);
		return createResolvedClientConfiguration({
			baseUrl: envConfig.baseUrl,
			headers: configToHeaders(envConfig),
			timeout: envConfig.timeout,
			retries: envConfig.retries,
		});
	}

	if ("auth" in config) {
		const fullConfig = createConfig(config);
		validateConfig(fullConfig);
		return createResolvedClientConfiguration({
			baseUrl: fullConfig.baseUrl,
			headers: configToHeaders(fullConfig),
			timeout: fullConfig.timeout,
			retries: fullConfig.retries,
		});
	}

	const directConfig = config as DirectListmonkClientConfig & {
		baseUrl: string;
	};
	return createResolvedClientConfiguration({
		baseUrl: directConfig.baseUrl,
		headers: directConfig.headers,
		timeout: directConfig.timeout,
		retries: directConfig.retries,
	});
}

export function createHealthCheckOperation(options: {
	baseUrl: string;
	headers?: Record<string, string>;
	resilientFetch: FetchFn;
}): EnhancedListmonkClient["getHealthCheck"] {
	return async () => {
		const healthCheckUrl = createHealthCheckUrl(options.baseUrl);
		const request = new Request(healthCheckUrl, {
			method: "GET",
			headers: options.headers,
		});
		const response = await options.resilientFetch(request);

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
	};
}

export function createListmonkClient(
	config?: ListmonkClientOptions,
): EnhancedListmonkClient {
	const resolvedConfig = resolveListmonkClientConfig(config);
	const resilientFetch = createResilientFetch({
		timeoutMs: resolvedConfig.timeout,
		retries: resolvedConfig.retries,
		baseFetch: globalThis.fetch.bind(globalThis) as FetchFn,
	});
	const sdkOptions: SdkOptions = {
		client: createClient({
			baseUrl: resolvedConfig.baseUrl,
			headers: resolvedConfig.headers,
			fetch: resilientFetch as unknown as typeof fetch,
		}),
	};

	return {
		getHealthCheck: createHealthCheckOperation({
			baseUrl: resolvedConfig.baseUrl,
			headers: resolvedConfig.headers,
			resilientFetch,
		}),
		list: createListOperations(sdkOptions),
		subscriber: createSubscriberOperations(sdkOptions),
		campaign: createCampaignOperations(sdkOptions),
		template: createTemplateOperations(sdkOptions),
		media: createMediaOperations(sdkOptions),
		import: createImportOperations(sdkOptions),
		bounce: createBounceOperations(sdkOptions),
		transactional: createTransactionalOperations(sdkOptions),
		settings: createSettingsOperations(sdkOptions),
		dashboard: createDashboardOperations(sdkOptions),
		system: createSystemOperations(sdkOptions),
	};
}

/**
 * @deprecated Use createListmonkClient() instead. This function will be removed in a future version.
 */
export function createListmonkClientFromEnv(
	overrides?: Partial<ListmonkConfig>,
): EnhancedListmonkClient {
	return createListmonkClient(overrides);
}

export const rawSdk = sdk;

export { createClient };
