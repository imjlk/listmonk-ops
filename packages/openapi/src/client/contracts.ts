import type * as t from "../../generated/types.gen";
import type { ListmonkConfig } from "../config";
import type { CrudOperations } from "./crud";
import type { CrudResult, FlattenedResponse, ListResult } from "./response";

type GetData<T> = Omit<T, "url" | "body" | "path">;
type GetByIdData<T> = Omit<T, "url" | "body" | "query">;
type CreateData<T> = Omit<T, "url" | "path" | "query">;
type UpdateData<T> = Omit<T, "url" | "query">;
type DeleteData<T> = Omit<T, "url" | "body" | "query">;

type ResourceTypes<TCreate, TGet, TGetById, TUpdate, TDelete> = {
	create: CreateData<TCreate>;
	get: GetData<TGet>;
	getById: GetByIdData<TGetById>;
	update: UpdateData<TUpdate>;
	delete: DeleteData<TDelete>;
};

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

export interface TemplateOperations
	extends CrudOperations<
		t.Template,
		TemplateTypes["create"],
		TemplateTypes["update"],
		TemplateTypes["get"],
		TemplateTypes["getById"],
		TemplateTypes["delete"]
	> {
	setAsDefault(options: {
		path: { id: number };
	}): Promise<FlattenedResponse<unknown>>;
}

interface MediaOperations {
	list(options?: t.GetMediaData): Promise<ListResult<t.MediaFileObject>>;
	getById(options: {
		path: { id: number };
	}): Promise<CrudResult<t.MediaFileObject>>;
	deleteById(options: {
		path: { id: number };
	}): Promise<FlattenedResponse<boolean>>;
}

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

export interface BounceListOptions {
	campaign_id?: number;
	page?: number;
	per_page?: number | "all";
	source?: string;
	order_by?: "email" | "campaign_name" | "source" | "created_at";
	order?: "asc" | "desc";
}

interface BaseBounceListOperation<T> {
	list(options?: BounceListOptions): Promise<ListResult<T>>;
}

export type ImportStartParams = {
	mode: "subscribe" | "blocklist";
	delim: string;
	lists: number[];
	overwrite: boolean;
	subscription_status?: string;
	file: File | Blob;
};

export type TransactionalSendParams = NonNullable<
	t.TransactWithSubscriberData["body"]
>;

export type CampaignTestParams = Omit<t.TestCampaignByIdData, "url">;

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

export type List = t.List;
export type Subscriber = t.Subscriber;
export type Campaign = t.Campaign;
export type Template = t.Template;
export type About = t.About;

export interface EnhancedListmonkClient {
	getHealthCheck(): Promise<FlattenedResponse<boolean>>;

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
				target_list_ids?: number[];
				query?: string;
				ids?: number[];
			};
		}): Promise<FlattenedResponse<boolean>>;
		manageListById(options: {
			path: { id: number };
			body: {
				action?: "add" | "remove" | "unsubscribe";
				target_list_ids?: number[];
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
				target_list_ids?: number[];
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
	template: TemplateOperations;
	media: MediaOperations & {
		upload(options: {
			body: File | Blob;
		}): Promise<FlattenedResponse<t.MediaFileObject>>;
	};

	import: ImportOperations;
	bounce: BounceOperations;
	transactional: TransactionalOperations;
	settings: SettingsOperations;
	dashboard: DashboardOperations;
	system: SystemOperations;
}

export type ListmonkClient = EnhancedListmonkClient;

export interface DirectListmonkClientConfig {
	baseUrl?: string;
	headers?: Record<string, string>;
	timeout?: number;
	retries?: number;
}

export type ListmonkClientOptions =
	| DirectListmonkClientConfig
	| Partial<ListmonkConfig>;
