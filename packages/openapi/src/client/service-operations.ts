import {
	deleteBounceById,
	deleteBounces,
	getAboutInfo,
	getBounceById,
	getBounces,
	getDashboardCharts,
	getDashboardCounts,
	getImportSubscribers,
	getImportSubscriberLogs,
	getLogs,
	getServerConfig,
	getSettings,
	importSubscribers,
	reloadApp,
	stopImportSubscribers,
	testSmtpSettings,
	transactWithSubscriber,
	updateSettings,
} from "../../generated/sdk.gen";
import type * as t from "../../generated/types.gen";
import type {
	BounceListOptions,
	EnhancedListmonkClient,
	ImportStartParams,
	TransactionalSendParams,
} from "./contracts";
import type { SdkOptions } from "./crud";
import type { CrudResult, FlattenedResponse } from "./response";
import { normalizeListResult, transformResponse } from "./response";

export function createImportOperations(
	sdkOptions: SdkOptions,
): EnhancedListmonkClient["import"] {
	return {
		async get() {
			const result = await getImportSubscribers(sdkOptions);
			return (await transformResponse(
				result,
			)) as FlattenedResponse<t.ImportStatus>;
		},
		async stop() {
			const result = await stopImportSubscribers(sdkOptions);
			return (await transformResponse(
				result,
			)) as FlattenedResponse<t.ImportStatus>;
		},
		async logs() {
			const result = await getImportSubscriberLogs(sdkOptions);
			return (await transformResponse(result)) as FlattenedResponse<string>;
		},
		async start(params: ImportStartParams) {
			const importParams = {
				mode: params.mode,
				delim: params.delim,
				lists: params.lists,
				overwrite: params.overwrite,
				...(params.subscription_status && {
					subscription_status: params.subscription_status,
				}),
			};
			const result = await importSubscribers({
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
	};
}

export function createBounceOperations(
	sdkOptions: SdkOptions,
): EnhancedListmonkClient["bounce"] {
	return {
		async list(options?: BounceListOptions) {
			const mergedOptions = options
				? { ...sdkOptions, query: options }
				: sdkOptions;
			const result = await getBounces(mergedOptions);
			return normalizeListResult<t.Bounce>(await transformResponse(result));
		},
		async getById(options: { path: { id: number } }) {
			const result = await getBounceById({ ...sdkOptions, ...options });
			return (await transformResponse(result)) as CrudResult<t.Bounce>;
		},
		async delete(options: { query: { all?: boolean; id?: string } }) {
			const result = await deleteBounces({ ...sdkOptions, ...options });
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
		async deleteById(options: { path: { id: number } }) {
			const result = await deleteBounceById({ ...sdkOptions, ...options });
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
	};
}

export function createTransactionalOperations(
	sdkOptions: SdkOptions,
): EnhancedListmonkClient["transactional"] {
	return {
		async send(options: TransactionalSendParams) {
			const result = await transactWithSubscriber({
				...sdkOptions,
				body: options,
			});
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
	};
}

export function createSettingsOperations(
	sdkOptions: SdkOptions,
): EnhancedListmonkClient["settings"] {
	return {
		async get() {
			const result = await getSettings(sdkOptions);
			return (await transformResponse(result)) as FlattenedResponse<t.Settings>;
		},
		async update(options: { body: Record<string, unknown> }) {
			const result = await updateSettings({ ...sdkOptions, ...options });
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
		async testSmtp(options: { body: Record<string, unknown> }) {
			const result = await testSmtpSettings({ ...sdkOptions, ...options });
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
	};
}

export function createDashboardOperations(
	sdkOptions: SdkOptions,
): EnhancedListmonkClient["dashboard"] {
	return {
		async getCharts(options?: { query?: { type?: string } }) {
			const mergedOptions = options ? { ...sdkOptions, ...options } : sdkOptions;
			const result = await getDashboardCharts(mergedOptions);
			return (await transformResponse(
				result,
			)) as FlattenedResponse<t.DashboardChart>;
		},
		async getCounts() {
			const result = await getDashboardCounts(sdkOptions);
			return (await transformResponse(
				result,
			)) as FlattenedResponse<t.DashboardCount>;
		},
	};
}

export function createSystemOperations(
	sdkOptions: SdkOptions,
): EnhancedListmonkClient["system"] {
	return {
		async getAbout() {
			const result = await getAboutInfo(sdkOptions);
			return (await transformResponse(result)) as FlattenedResponse<t.About>;
		},
		async getConfig() {
			const result = await getServerConfig(sdkOptions);
			return (await transformResponse(
				result,
			)) as FlattenedResponse<t.ServerConfig>;
		},
		async getLogs() {
			const result = await getLogs(sdkOptions);
			return (await transformResponse(result)) as FlattenedResponse<string[]>;
		},
		async reload() {
			const result = await reloadApp(sdkOptions);
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
	};
}
