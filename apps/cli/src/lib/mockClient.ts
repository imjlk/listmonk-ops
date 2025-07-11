import type { Campaign, List } from "@listmonk-ops/openapi";

// Mock client for development with explicit types
export const mockListmonkClient = {
	getCampaigns: async (): Promise<{
		data: {
			results: Campaign[];
			total: number;
			per_page: number;
			page: number;
		};
		request: Request;
		response: Response;
	}> => ({
		data: {
			results: [
				{
					id: 1,
					name: "Welcome Series",
					status: "running",
					sent: 1250,
					clicks: 145,
					views: 890,
				},
				{
					id: 2,
					name: "Product Launch",
					status: "draft",
					sent: 0,
					clicks: 0,
					views: 0,
				},
				{
					id: 3,
					name: "Weekly Newsletter",
					status: "finished",
					sent: 5430,
					clicks: 621,
					views: 3210,
				},
			],
			total: 3,
			per_page: 20,
			page: 1,
		},
		request: {} as Request,
		response: {} as Response,
	}),
	getCampaignById: async ({
		path,
	}: {
		path: { campaign_id: number };
	}): Promise<{
		data: Campaign;
		request: Request;
		response: Response;
	}> => ({
		data: {
			id: path.campaign_id,
			name: `Campaign ${path.campaign_id}`,
			status: "running",
			sent: 2500,
			clicks: 350,
			views: 1800,
		},
		request: {} as Request,
		response: {} as Response,
	}),
	getLists: async (): Promise<{
		data: {
			results: List[];
			total: number;
			per_page: number;
			page: number;
		};
		request: Request;
		response: Response;
	}> => ({
		data: {
			results: [
				{
					id: 1,
					name: "Newsletter Subscribers",
					type: "public",
					subscriber_count: 1500,
				},
				{
					id: 2,
					name: "Product Updates",
					type: "private",
					subscriber_count: 850,
				},
			],
			total: 2,
			per_page: 20,
			page: 1,
		},
		request: {} as Request,
		response: {} as Response,
	}),
	getListById: async ({
		path,
	}: {
		path: { list_id: number };
	}): Promise<{
		data: List;
		request: Request;
		response: Response;
	}> => ({
		data: {
			id: path.list_id,
			name: `List ${path.list_id}`,
			type: "public",
			subscriber_count: 1000,
			description: `Description for list ${path.list_id}`,
			created_at: new Date().toISOString(),
		},
		request: {} as Request,
		response: {} as Response,
	}),
};
