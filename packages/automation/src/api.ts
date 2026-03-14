import type {
	Campaign,
	List,
	ListmonkClient,
	Template,
} from "@listmonk-ops/openapi";

import { toPositiveInt } from "./core";

type DataResponse<T> = {
	data?: T;
	error?: unknown;
};

function formatResponseError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function unwrapResponseData<T>(
	response: DataResponse<T>,
	context: string,
): T {
	if ("error" in response && response.error !== undefined) {
		throw new Error(`${context}: ${formatResponseError(response.error)}`);
	}

	if (response.data === undefined) {
		throw new Error(`${context}: received empty data`);
	}

	return response.data;
}

export async function getCampaign(
	client: ListmonkClient,
	campaignId: number,
): Promise<Campaign> {
	const response = await client.campaign.getById({
		path: { id: campaignId },
	});
	return unwrapResponseData(response, `Failed to fetch campaign ${campaignId}`);
}

export async function getListById(
	client: ListmonkClient,
	listId: number,
): Promise<List> {
	const response = await client.list.getById({
		path: { list_id: listId },
	});
	return unwrapResponseData(response, `Failed to fetch list ${listId}`);
}

export async function getTemplateById(
	client: ListmonkClient,
	templateId: number,
): Promise<Template> {
	const response = await client.template.getById({
		path: { id: templateId },
	});
	return unwrapResponseData(response, `Failed to fetch template ${templateId}`);
}

export function getCampaignListIds(campaign: Campaign): number[] {
	return (campaign.lists || [])
		.map((entry) => toPositiveInt(entry.id))
		.filter((value): value is number => value !== undefined);
}
