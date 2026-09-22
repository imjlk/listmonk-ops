export * from "./generated/index";
export { createClient } from "./generated/client/client.gen";
export type {
	Client,
	ClientOptions,
	Config,
	CreateClientConfig,
	Options,
	RequestOptions,
	RequestResult,
	ResolvedRequestOptions,
	ResponseStyle,
	TDataShape,
} from "./generated/client/types.gen";

export {
	getCampaigns,
	type GetCampaignsData,
} from "./src/client/campaign-query";
