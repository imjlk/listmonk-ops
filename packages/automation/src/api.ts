import type {
	Campaign,
	List,
	ListmonkClient,
	Template,
} from "@listmonk-ops/openapi";

import { toPositiveInt } from "./core";

export async function getCampaign(
	client: ListmonkClient,
	campaignId: number,
): Promise<Campaign> {
	const response = await client.campaign.getById({
		path: { id: campaignId },
	});

	if ("error" in response) {
		throw new Error(
			`Failed to fetch campaign ${campaignId}: ${response.error}`,
		);
	}

	return response.data || ({} as Campaign);
}

export async function getListById(
	client: ListmonkClient,
	listId: number,
): Promise<List> {
	const response = await client.list.getById({
		path: { list_id: listId },
	});
	if ("error" in response) {
		throw new Error(`Failed to fetch list ${listId}: ${response.error}`);
	}
	return response.data || ({} as List);
}

export async function getTemplateById(
	client: ListmonkClient,
	templateId: number,
): Promise<Template> {
	const response = await client.template.getById({
		path: { id: templateId },
	});
	if ("error" in response) {
		throw new Error(
			`Failed to fetch template ${templateId}: ${response.error}`,
		);
	}
	return response.data || ({} as Template);
}

export function getCampaignListIds(campaign: Campaign): number[] {
	return (campaign.lists || [])
		.map((entry) => toPositiveInt(entry.id))
		.filter((value): value is number => value !== undefined);
}
