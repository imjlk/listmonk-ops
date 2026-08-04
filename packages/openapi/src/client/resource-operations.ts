import {
	blocklistSubscribersQuery,
	createCampaign,
	createCampaignContentById,
	createList,
	createSubscriber,
	createTemplate,
	deleteCampaignById,
	deleteListById,
	deleteMediaById,
	deleteSubscriberById,
	deleteSubscriberBouncesById,
	deleteSubscriberByQuery,
	deleteTemplateById,
	exportSubscriberDataById,
	getCampaignAnalytics,
	getCampaignById,
	getCampaigns,
	getListById,
	getLists,
	getMedia,
	getMediaById,
	getRunningCampaignStats,
	getSubscriberById,
	getSubscriberBouncesById,
	getSubscribers,
	getTemplateById,
	getTemplates,
	manageBlocklistBySubscriberList,
	manageBlocklistSubscribersById,
	manageSubscriberListById,
	manageSubscriberLists,
	manageSubscriberListsByQuery,
	patchSubscriberById,
	previewCampaignById,
	previewCampaignTextById,
	setDefaultTemplateById,
	subscriberSendOptinById,
	testCampaignById,
	updateCampaignArchiveById,
	updateCampaignById,
	updateCampaignStatusById,
	updateListById,
	updatePreviewCampaignById,
	updateSubscriberById,
	updateTemplateById,
	uploadMedia,
} from "../../generated/sdk.gen";
import type * as t from "../../generated/types.gen";
import type {
	Campaign,
	CampaignTestParams,
	EnhancedListmonkClient,
	List,
	Subscriber,
	TemplateOperations,
} from "./contracts";
import {
	createCrudOperations,
	staticSdkMethod,
	unsupportedCrudMethod,
	type SdkOptions,
} from "./crud";
import type { CrudResult, FlattenedResponse } from "./response";
import { transformResponse } from "./response";

export function createListOperations(
	sdkOptions: SdkOptions,
): EnhancedListmonkClient["list"] {
	return createCrudOperations<List>(
		{
			create: staticSdkMethod(createList),
			list: staticSdkMethod(getLists),
			getById: staticSdkMethod(getListById),
			update: staticSdkMethod(updateListById),
			delete: staticSdkMethod(deleteListById),
		},
		sdkOptions,
	);
}

export function createSubscriberOperations(
	sdkOptions: SdkOptions,
): EnhancedListmonkClient["subscriber"] {
	return {
		...createCrudOperations<Subscriber>(
			{
				create: staticSdkMethod(createSubscriber),
				list: staticSdkMethod(getSubscribers),
				getById: staticSdkMethod(getSubscriberById),
				update: staticSdkMethod(updateSubscriberById),
				delete: staticSdkMethod(deleteSubscriberById),
			},
			sdkOptions,
		),
		async patch(options: Omit<t.PatchSubscriberByIdData, "url">) {
			const result = await patchSubscriberById({ ...sdkOptions, ...options });
			return (await transformResponse(result)) as CrudResult<Subscriber>;
		},
		async manageLists(options: {
			body: {
				action?: "add" | "remove" | "unsubscribe";
				target_list_ids?: number[];
				query?: string;
				ids?: number[];
			};
		}) {
			const result = await manageSubscriberLists({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
		async manageListById(options: {
			path: { id: number };
			body: {
				action?: "add" | "remove" | "unsubscribe";
				target_list_ids?: number[];
				query?: string;
				ids?: number[];
			};
		}) {
			const result = await manageSubscriberListById({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
		async manageBlocklist(options: {
			body: { action?: "add" | "remove"; query?: string; ids?: number[] };
		}) {
			const result = await manageBlocklistBySubscriberList({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
		async manageBlocklistById(options: {
			path: { id: number };
			body: { action?: "add" | "remove" };
		}) {
			const result = await manageBlocklistSubscribersById({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
		async export(options: { path: { id: number } }) {
			const result = await exportSubscriberDataById({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<
				Record<string, unknown>
			>;
		},
		async sendOptin(options: { path: { id: number } }) {
			const result = await subscriberSendOptinById({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
		async getBounces(options: { path: { id: number } }) {
			const result = await getSubscriberBouncesById({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<
				Record<string, unknown>
			>;
		},
		async deleteBounces(options: { path: { id: number } }) {
			const result = await deleteSubscriberBouncesById({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
		async deleteByQuery(options: { body: { query?: string } }) {
			const result = await deleteSubscriberByQuery({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
		async blocklistByQuery(options: { body: { query?: string } }) {
			const result = await blocklistSubscribersQuery({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
		async manageListsByQuery(options: {
			body: {
				action?: "add" | "remove" | "unsubscribe";
				target_list_ids?: number[];
				query?: string;
			};
		}) {
			const result = await manageSubscriberListsByQuery({
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
		...createCrudOperations<Campaign>(
			{
				create: staticSdkMethod(createCampaign),
				list: staticSdkMethod(getCampaigns),
				getById: staticSdkMethod(getCampaignById),
				update: staticSdkMethod(updateCampaignById),
				delete: staticSdkMethod(deleteCampaignById),
			},
			sdkOptions,
		),
		async preview(options: { path: { id: number } }) {
			const result = await previewCampaignById({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<string>;
		},
		async updatePreview(options: {
			path: { id: number };
			body: { template_id?: number; body?: string };
		}) {
			const result = await updatePreviewCampaignById({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
		async previewText(options: {
			path: { id: number };
			body: { template_id?: number; body?: string };
		}) {
			const result = await previewCampaignTextById({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<string>;
		},
		async updateStatus(options: {
			path: { id: number };
			body: { status: "scheduled" | "running" | "paused" | "cancelled" };
		}) {
			const result = await updateCampaignStatusById({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
		async updateArchive(options: {
			path: { id: number };
			body: { archive: boolean };
		}) {
			const result = await updateCampaignArchiveById({
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
			const result = await createCampaignContentById({
				...sdkOptions,
				...options,
			});
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
		async test(options: CampaignTestParams) {
			const result = await testCampaignById({ ...sdkOptions, ...options });
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
		async getRunningStats(options: { query: { campaign_id: number } }) {
			const result = await getRunningCampaignStats({
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
			const result = await getCampaignAnalytics({
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
		...createCrudOperations<t.Template>(
			{
				create: staticSdkMethod(createTemplate),
				list: staticSdkMethod(getTemplates),
				getById: staticSdkMethod(getTemplateById),
				update: staticSdkMethod(updateTemplateById),
				delete: staticSdkMethod(deleteTemplateById),
			},
			sdkOptions,
		),
		async setAsDefault(options: { path: { id: number } }) {
			const result = await setDefaultTemplateById({
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
		{
			create: unsupportedCrudMethod("Media", "create"),
			list: staticSdkMethod(getMedia),
			getById: staticSdkMethod(getMediaById),
			update: unsupportedCrudMethod("Media", "update"),
			delete: staticSdkMethod(deleteMediaById),
		},
		sdkOptions,
	);
	return {
		list: crudOperations.list as EnhancedListmonkClient["media"]["list"],
		getById:
			crudOperations.getById as EnhancedListmonkClient["media"]["getById"],
		deleteById:
			crudOperations.delete as EnhancedListmonkClient["media"]["deleteById"],
		async upload(options: { body: File | Blob }) {
			// The generated `uploadMedia` SDK call applies
			// `formDataBodySerializer`, which iterates `Object.entries(body)`
			// to build the multipart form. A bare `File`/`Blob` has no
			// enumerable entries, so we must wrap it under the `file` field
			// name Listmonk expects. Otherwise the serializer emits an empty
			// FormData and the upload silently succeeds with no file.
			const result = await uploadMedia({
				...sdkOptions,
				body: { file: options.body },
			} as unknown as Parameters<typeof uploadMedia>[0]);
			return (await transformResponse(
				result,
			)) as FlattenedResponse<t.MediaFileObject>;
		},
	};
}
