import { ValidationError } from "@listmonk-ops/common";
import type { Campaign } from "@listmonk-ops/openapi";
import { BaseCommand } from "./base";
import type { ListmonkClient } from "./types";

// Campaign Commands
export class ListCampaignsCommand extends BaseCommand<void, Campaign[]> {
	constructor(private listmonkClient: ListmonkClient) {
		super();
	}

	async execute(): Promise<Campaign[]> {
		const result = await this.listmonkClient.getCampaigns();
		return result.data.results;
	}
}

export class GetCampaignCommand extends BaseCommand<string, Campaign> {
	constructor(private listmonkClient: ListmonkClient) {
		super();
	}

	async execute(campaignId: string): Promise<Campaign> {
		this.validate(campaignId);
		const result = await this.listmonkClient.getCampaignById({
			path: { campaign_id: Number(campaignId) },
		});

		if ("error" in result) {
			throw new ValidationError(`Campaign with ID ${campaignId} not found`);
		}

		return result.data;
	}

	protected override validate(campaignId: string): void {
		if (!campaignId || campaignId.trim().length === 0) {
			throw new ValidationError("Campaign ID is required");
		}
		const id = Number(campaignId);
		if (Number.isNaN(id) || id <= 0) {
			throw new ValidationError("Campaign ID must be a positive number");
		}
	}
}

// Campaign command executors factory
export function createCampaignExecutors(listmonkClient: ListmonkClient) {
	return {
		listCampaigns: (): Promise<Campaign[]> =>
			new ListCampaignsCommand(listmonkClient).execute(),

		getCampaign: (id: string): Promise<Campaign> =>
			new GetCampaignCommand(listmonkClient).execute(id),
	};
}
