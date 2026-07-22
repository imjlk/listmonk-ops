import * as sdk from "../../generated/sdk.gen";
import type * as t from "../../generated/types.gen";
import type {
	Campaign,
	CampaignTestParams,
	EnhancedListmonkClient,
	List,
	Subscriber,
	TemplateOperations,
} from "./contracts";
import { createCrudOperations, type SdkOptions } from "./crud";
import type { CrudResult, FlattenedResponse } from "./response";
import { transformResponse } from "./response";

export function createListOperations(
	sdkOptions: SdkOptions,
): EnhancedListmonkClient["list"] {
	return createCrudOperations<List>("List", sdkOptions);
}

export function createSubscriberOperations(
	sdkOptions: SdkOptions,
): EnhancedListmonkClient["subscriber"] {
	return {
		...createCrudOperations<Subscriber>("Subscriber", sdkOptions),
		async patch(options: Omit<t.PatchSubscriberByIdData, "url">) {
			const result = await sdk.patchSubscriberById({ ...sdkOptions, ...options });
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
			const result = await sdk.manageSubscriberLists({
				...sdkOptions,
				...options,
			});
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
			const result = await sdk.manageSubscriberListById({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
		async manageBlocklist(options: {
			body: { action?: "add" | "remove"; query?: string; ids?: number[] };
		}) {
			const result = await sdk.manageBlocklistBySubscriberList({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
		async manageBlocklistById(options: {
			path: { id: number };
			body: { action?: "add" | "remove" };
		}) {
			const result = await sdk.manageBlocklistSubscribersById({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
		async export(options: { path: { id: number } }) {
			const result = await sdk.exportSubscriberDataById({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<
				Record<string, unknown>
			>;
		},
		async sendOptin(options: { path: { id: number } }) {
			const result = await sdk.subscriberSendOptinById({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
		async getBounces(options: { path: { id: number } }) {
			const result = await sdk.getSubscriberBouncesById({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<
				Record<string, unknown>
			>;
		},
		async deleteBounces(options: { path: { id: number } }) {
			const result = await sdk.deleteSubscriberBouncesById({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
		async deleteByQuery(options: { body: { query?: string } }) {
			const result = await sdk.deleteSubscriberByQuery({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
		async blocklistByQuery(options: { body: { query?: string } }) {
			const result = await sdk.blocklistSubscribersQuery({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
		async manageListsByQuery(options: {
			body: {
				action?: "add" | "remove" | "unsubscribe";
				target_list_ids?: number;
				query?: string;
			};
		}) {
			const result = await sdk.manageSubscriberListsByQuery({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
	};
}

export function createCampaignOperations(
	sdkOptions: SdkOptions,
): EnhancedListmonkClient["campaign"] {
	return {
		...createCrudOperations<Campaign>("Campaign", sdkOptions),
		async preview(options: { path: { id: number } }) {
			const result = await sdk.previewCampaignById({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<string>;
		},
		async updatePreview(options: {
			path: { id: number };
			body: { template_id?: number; body?: string };
		}) {
			const result = await sdk.updatePreviewCampaignById({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
		async previewText(options: {
			path: { id: number };
			body: { template_id?: number; body?: string };
		}) {
			const result = await sdk.previewCampaignTextById({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<string>;
		},
		async updateStatus(options: {
			path: { id: number };
			body: { status: "scheduled" | "running" | "paused" | "cancelled" };
		}) {
			const result = await sdk.updateCampaignStatusById({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
		async updateArchive(options: {
			path: { id: number };
			body: { archive: boolean };
		}) {
			const result = await sdk.updateCampaignArchiveById({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
		async createContent(options: {
			path: { id: number };
			body: {
				content_type: "html" | "markdown" | "plain" | "richtext" | "visual";
				body: string;
			};
		}) {
			const result = await sdk.createCampaignContentById({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
		async test(options: CampaignTestParams) {
			const result = await sdk.testCampaignById({ ...sdkOptions, ...options });
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
		async getRunningStats(options: { query: { campaign_id: number } }) {
			const result = await sdk.getRunningCampaignStats({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<
				Record<string, unknown>
			>;
		},
		async getAnalytics(options: {
			path: { type: "links" | "views" | "clicks" | "bounces" };
			query: { from: string; to: string; id: string };
		}) {
			const result = await sdk.getCampaignAnalytics({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<
				Record<string, unknown>
			>;
		},
	};
}

export function createTemplateOperations(
	sdkOptions: SdkOptions,
): TemplateOperations {
	return {
		...createCrudOperations<t.Template>("Template", sdkOptions),
		async setAsDefault(options: { path: { id: number } }) {
			const result = await sdk.setDefaultTemplateById({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<unknown>;
		},
	};
}

export function createMediaOperations(
	sdkOptions: SdkOptions,
): EnhancedListmonkClient["media"] {
	const crudOperations = createCrudOperations<t.MediaFileObject>(
		"Media",
		sdkOptions,
		{ list: ["getMedia"] },
	);
	return {
		list: crudOperations.list as EnhancedListmonkClient["media"]["list"],
		getById:
			crudOperations.getById as EnhancedListmonkClient["media"]["getById"],
		deleteById:
			crudOperations.delete as EnhancedListmonkClient["media"]["deleteById"],
		async upload(options: { body: File | Blob }) {
			const result = await sdk.uploadMedia({ ...sdkOptions, ...options });
			return (await transformResponse(
				result,
			)) as FlattenedResponse<t.MediaFileObject>;
		},
	};
}
