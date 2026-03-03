import type {
	Campaign,
	List,
	ListmonkClient,
	Subscriber,
} from "@listmonk-ops/openapi";

import { evaluateDeliverabilityGuard } from "./campaign";
import {
	extractResults,
	type RecordValue,
	toDate,
	toPositiveInt,
} from "./core";

export interface DailyDigestOptions {
	hours?: number;
	bounceThreshold?: number;
	openRateThreshold?: number;
	clickRateThreshold?: number;
}

export interface DailyDigestResult {
	generatedAt: string;
	window: {
		hours: number;
		from: string;
		to: string;
	};
	metrics: {
		lists: number;
		subscribers: number;
		subscriberStatus: Record<string, number>;
		campaigns: number;
		runningCampaigns: number;
		campaignsCreatedInWindow: number;
		sent: number;
		views: number;
		clicks: number;
		bouncesInWindow: number;
	};
	risk: {
		campaignBreaches: Array<{
			campaignId: number;
			campaignName: string;
			breaches: string[];
		}>;
	};
	markdown: string;
}

function countBy<T>(
	items: T[],
	getKey: (item: T) => string,
): Record<string, number> {
	return items.reduce<Record<string, number>>((acc, item) => {
		const key = getKey(item);
		acc[key] = (acc[key] || 0) + 1;
		return acc;
	}, {});
}

export async function generateDailyDigest(
	client: ListmonkClient,
	options: DailyDigestOptions = {},
): Promise<DailyDigestResult> {
	const hours = Math.max(1, options.hours ?? 24);
	const now = new Date();
	const from = new Date(now.getTime() - hours * 60 * 60 * 1000);

	const [
		listsResponse,
		subscribersResponse,
		campaignsResponse,
		bouncesResponse,
	] = await Promise.all([
		client.list.list({ query: { per_page: "all" } }),
		client.subscriber.list({ query: { per_page: "all" } }),
		client.campaign.list({ query: { per_page: "all" } }),
		client.bounce.list({ per_page: "all" }),
	]);

	const lists = extractResults<List>(listsResponse.data);
	const subscribers = extractResults<Subscriber>(subscribersResponse.data);
	const campaigns = extractResults<Campaign>(campaignsResponse.data);
	const bounces = extractResults<RecordValue>(bouncesResponse.data);

	const subscriberStatus = countBy(subscribers, (subscriber) =>
		String(subscriber.status || "unknown").toLowerCase(),
	);

	const runningCampaigns = campaigns.filter((campaign) =>
		["running", "scheduled"].includes(
			String(campaign.status || "").toLowerCase(),
		),
	);

	const campaignsCreatedInWindow = campaigns.filter((campaign) => {
		const createdAt = toDate(campaign.created_at);
		return createdAt ? createdAt >= from : false;
	});

	const bouncesInWindow = bounces.filter((bounce) => {
		const createdAt =
			typeof bounce.created_at === "string"
				? toDate(bounce.created_at)
				: undefined;
		return createdAt ? createdAt >= from : false;
	}).length;

	const sent = campaigns.reduce(
		(sum, campaign) => sum + Math.max(0, Number(campaign.sent || 0)),
		0,
	);
	const views = campaigns.reduce(
		(sum, campaign) => sum + Math.max(0, Number(campaign.views || 0)),
		0,
	);
	const clicks = campaigns.reduce(
		(sum, campaign) => sum + Math.max(0, Number(campaign.clicks || 0)),
		0,
	);

	const campaignBreaches: DailyDigestResult["risk"]["campaignBreaches"] = [];
	for (const campaign of runningCampaigns.slice(0, 10)) {
		const campaignId = toPositiveInt(campaign.id);
		if (!campaignId) {
			continue;
		}
		const guardResult = await evaluateDeliverabilityGuard(client, campaignId, {
			bounceThreshold: options.bounceThreshold,
			openRateThreshold: options.openRateThreshold,
			clickRateThreshold: options.clickRateThreshold,
			pauseOnBreach: false,
		});
		if (guardResult.breaches.length > 0) {
			campaignBreaches.push({
				campaignId,
				campaignName: guardResult.campaignName,
				breaches: guardResult.breaches,
			});
		}
	}

	const markdownLines = [
		"# Listmonk Ops Daily Digest",
		`- Generated: ${now.toISOString()}`,
		`- Window: last ${hours}h (${from.toISOString()} ~ ${now.toISOString()})`,
		"",
		"## KPI Snapshot",
		`- Lists: ${lists.length.toLocaleString()}`,
		`- Subscribers: ${subscribers.length.toLocaleString()}`,
		`- Campaigns: ${campaigns.length.toLocaleString()} (running/scheduled: ${runningCampaigns.length.toLocaleString()})`,
		`- Campaigns created in window: ${campaignsCreatedInWindow.length.toLocaleString()}`,
		`- Sent: ${sent.toLocaleString()}, Views: ${views.toLocaleString()}, Clicks: ${clicks.toLocaleString()}`,
		`- Bounces in window: ${bouncesInWindow.toLocaleString()}`,
		"",
		"## Subscriber Status",
		...Object.entries(subscriberStatus).map(
			([status, count]) => `- ${status}: ${count.toLocaleString()}`,
		),
		"",
		"## Risk Alerts",
		...(campaignBreaches.length > 0
			? campaignBreaches.map(
					(entry) =>
						`- Campaign ${entry.campaignId} (${entry.campaignName}): ${entry.breaches.join("; ")}`,
				)
			: ["- No active deliverability breaches detected"]),
	];

	return {
		generatedAt: now.toISOString(),
		window: {
			hours,
			from: from.toISOString(),
			to: now.toISOString(),
		},
		metrics: {
			lists: lists.length,
			subscribers: subscribers.length,
			subscriberStatus,
			campaigns: campaigns.length,
			runningCampaigns: runningCampaigns.length,
			campaignsCreatedInWindow: campaignsCreatedInWindow.length,
			sent,
			views,
			clicks,
			bouncesInWindow,
		},
		risk: {
			campaignBreaches,
		},
		markdown: markdownLines.join("\n"),
	};
}
