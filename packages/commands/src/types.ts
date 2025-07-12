import type { Campaign, List } from "@listmonk-ops/openapi";

// Generic Listmonk client interface for commands
export interface ListmonkClient {
	getCampaigns(): Promise<{
		data: {
			results: Campaign[];
			total: number;
			per_page: number;
			page: number;
		};
		request: Request;
		response: Response;
	}>;
	getCampaignById(params: { path: { campaign_id: number } }): Promise<
		| {
			data: Campaign;
			request: Request;
			response: Response;
		}
		| { error: unknown }
	>;
	getLists(): Promise<{
		data: {
			results: List[];
			total: number;
			per_page: number;
			page: number;
		};
		request: Request;
		response: Response;
	}>;
	getListById(params: { path: { list_id: number } }): Promise<
		| {
			data: List;
			request: Request;
			response: Response;
		}
		| { error: unknown }
	>;
}
