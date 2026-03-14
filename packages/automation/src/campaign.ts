import type { ListmonkClient } from "@listmonk-ops/openapi";

import {
	getCampaign,
	getCampaignListIds,
	getListById,
	unwrapResponseData,
} from "./api";
import { extractResults, type RecordValue } from "./core";

export type CheckLevel = "pass" | "warn" | "fail";

export interface CampaignPreflightCheck {
	id: string;
	level: CheckLevel;
	message: string;
	details?: Record<string, unknown>;
}

export interface CampaignPreflightResult {
	campaignId: number;
	campaignName: string;
	status: string;
	audienceEstimate: number;
	checkedAt: string;
	checks: CampaignPreflightCheck[];
	summary: {
		pass: number;
		warn: number;
		fail: number;
	};
}

export interface CampaignPreflightOptions {
	maxAudience?: number;
	checkLinks?: boolean;
	linkCheckTimeoutMs?: number;
}

function summarizeChecks(checks: CampaignPreflightCheck[]) {
	return {
		pass: checks.filter((check) => check.level === "pass").length,
		warn: checks.filter((check) => check.level === "warn").length,
		fail: checks.filter((check) => check.level === "fail").length,
	};
}

function collectBodyLinks(body: string): string[] {
	const matches = body.match(/https?:\/\/[^\s"'<>()]+/g) || [];
	return Array.from(new Set(matches));
}

async function checkLink(
	url: string,
	timeoutMs: number,
): Promise<{
	url: string;
	ok: boolean;
	status?: number;
	error?: string;
}> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		let response = await fetch(url, {
			method: "HEAD",
			redirect: "follow",
			signal: controller.signal,
		});

		if (response.status === 405 || response.status === 501) {
			response = await fetch(url, {
				method: "GET",
				redirect: "follow",
				signal: controller.signal,
			});
		}

		return {
			url,
			ok: response.status < 400,
			status: response.status,
		};
	} catch (error) {
		return {
			url,
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		clearTimeout(timeout);
	}
}

export async function runCampaignPreflight(
	client: ListmonkClient,
	campaignId: number,
	options: CampaignPreflightOptions = {},
): Promise<CampaignPreflightResult> {
	const maxAudience = options.maxAudience ?? 200_000;
	const linkCheckTimeoutMs = options.linkCheckTimeoutMs ?? 4_000;
	const checkLinks = options.checkLinks ?? false;
	const checks: CampaignPreflightCheck[] = [];
	const campaign = await getCampaign(client, campaignId);

	const campaignName = campaign.name?.trim() || `Campaign ${campaignId}`;
	const status = campaign.status || "unknown";
	const subject = campaign.subject?.trim() || "";
	const body = campaign.body || "";
	const listIds = getCampaignListIds(campaign);

	if (subject.length > 0) {
		checks.push({
			id: "subject_present",
			level: "pass",
			message: "Subject is present",
		});
	} else {
		checks.push({
			id: "subject_present",
			level: "fail",
			message: "Subject is empty",
		});
	}

	if (body.trim().length > 0) {
		checks.push({
			id: "body_present",
			level: "pass",
			message: "Body content exists",
		});
	} else {
		checks.push({
			id: "body_present",
			level: "fail",
			message: "Body is empty",
		});
	}

	if (body.toLowerCase().includes("unsubscribe")) {
		checks.push({
			id: "unsubscribe_link",
			level: "pass",
			message: "Unsubscribe marker found in body",
		});
	} else {
		checks.push({
			id: "unsubscribe_link",
			level: "fail",
			message: "Unsubscribe marker not found in body",
		});
	}

	const openBraces = body.match(/{{/g)?.length ?? 0;
	const closeBraces = body.match(/}}/g)?.length ?? 0;
	if (openBraces === closeBraces) {
		checks.push({
			id: "template_tokens",
			level: "pass",
			message: "Template token braces are balanced",
		});
	} else {
		checks.push({
			id: "template_tokens",
			level: "fail",
			message: "Template token braces are unbalanced",
			details: { openBraces, closeBraces },
		});
	}

	if (listIds.length === 0) {
		checks.push({
			id: "target_lists",
			level: "fail",
			message: "Campaign has no target lists",
		});
	}

	let audienceEstimate = 0;
	for (const listId of listIds) {
		const list = await getListById(client, listId);
		audienceEstimate += Math.max(0, Number(list.subscriber_count || 0));
	}

	checks.push({
		id: "audience_estimate",
		level:
			audienceEstimate > maxAudience
				? "warn"
				: audienceEstimate === 0
					? "fail"
					: "pass",
		message:
			audienceEstimate > maxAudience
				? `Audience estimate ${audienceEstimate.toLocaleString()} exceeds threshold ${maxAudience.toLocaleString()}`
				: audienceEstimate === 0
					? "Audience estimate is zero"
					: `Audience estimate ${audienceEstimate.toLocaleString()} is within threshold`,
		details: { audienceEstimate, maxAudience },
	});

	const sendStatuses = new Set(["running", "finished"]);
	checks.push({
		id: "status_gate",
		level: sendStatuses.has(status) ? "warn" : "pass",
		message: sendStatuses.has(status)
			? `Campaign is already in ${status} state`
			: `Campaign status ${status} is preflight-safe`,
	});

	if (campaign.template_id) {
		try {
			const templateResponse = await client.template.getById({
				path: { id: campaign.template_id },
			});
			if ("error" in templateResponse || !templateResponse.data?.id) {
				checks.push({
					id: "template_reference",
					level: "fail",
					message: `Template ${campaign.template_id} is not accessible`,
				});
			} else {
				checks.push({
					id: "template_reference",
					level: "pass",
					message: `Template ${campaign.template_id} is accessible`,
				});
			}
		} catch (error) {
			checks.push({
				id: "template_reference",
				level: "fail",
				message: `Template ${campaign.template_id} lookup failed`,
				details: {
					error: error instanceof Error ? error.message : String(error),
				},
			});
		}
	} else {
		checks.push({
			id: "template_reference",
			level: "warn",
			message: "No template_id configured on campaign",
		});
	}

	if (checkLinks) {
		const links = collectBodyLinks(body).slice(0, 20);
		if (links.length === 0) {
			checks.push({
				id: "link_health",
				level: "warn",
				message: "No http(s) links found in campaign body",
			});
		} else {
			const linkResults = await Promise.all(
				links.map((url) => checkLink(url, linkCheckTimeoutMs)),
			);
			const brokenLinks = linkResults.filter((entry) => !entry.ok);
			checks.push({
				id: "link_health",
				level: brokenLinks.length > 0 ? "warn" : "pass",
				message:
					brokenLinks.length > 0
						? `${brokenLinks.length} link(s) failed health check`
						: `${linkResults.length} link(s) passed health check`,
				details: {
					checked: linkResults.length,
					broken: brokenLinks,
				},
			});
		}
	}

	return {
		campaignId,
		campaignName,
		status,
		audienceEstimate,
		checkedAt: new Date().toISOString(),
		checks,
		summary: summarizeChecks(checks),
	};
}

export interface DeliverabilityGuardOptions {
	bounceThreshold?: number;
	openRateThreshold?: number;
	clickRateThreshold?: number;
	pauseOnBreach?: boolean;
}

export interface DeliverabilityGuardResult {
	campaignId: number;
	campaignName: string;
	status: string;
	checkedAt: string;
	metrics: {
		sent: number;
		toSend: number;
		views: number;
		clicks: number;
		bounces: number;
		bounceRate: number;
		openRate: number;
		clickRate: number;
	};
	thresholds: {
		bounceRate: number;
		openRate: number;
		clickRate: number;
	};
	breaches: string[];
	paused: boolean;
}

function getBounceCount(payload: unknown): number {
	const results = extractResults<RecordValue>(payload);
	return results.length;
}

export async function evaluateDeliverabilityGuard(
	client: ListmonkClient,
	campaignId: number,
	options: DeliverabilityGuardOptions = {},
): Promise<DeliverabilityGuardResult> {
	const thresholds = {
		bounceRate: options.bounceThreshold ?? 0.05,
		openRate: options.openRateThreshold ?? 0.08,
		clickRate: options.clickRateThreshold ?? 0.01,
	};
	const campaign = await getCampaign(client, campaignId);
	const campaignName = campaign.name?.trim() || `Campaign ${campaignId}`;
	const sent = Math.max(0, Number(campaign.sent || 0));
	const toSend = Math.max(0, Number(campaign.to_send || 0));
	const views = Math.max(0, Number(campaign.views || 0));
	const clicks = Math.max(0, Number(campaign.clicks || 0));
	const status = campaign.status || "unknown";

	const bounceResponse = await client.bounce.list({
		campaign_id: campaignId,
		per_page: "all",
	});
	const bounces = getBounceCount(
		unwrapResponseData(
			bounceResponse,
			`Failed to list bounces for campaign ${campaignId}`,
		),
	);
	const bounceRate = sent > 0 ? bounces / sent : 0;
	const openRate = sent > 0 ? views / sent : 0;
	const clickRate = sent > 0 ? clicks / sent : 0;

	const breaches: string[] = [];
	if (bounceRate > thresholds.bounceRate) {
		breaches.push(
			`Bounce rate ${(bounceRate * 100).toFixed(2)}% is above ${(thresholds.bounceRate * 100).toFixed(2)}%`,
		);
	}

	if (sent > 0 && openRate < thresholds.openRate) {
		breaches.push(
			`Open rate ${(openRate * 100).toFixed(2)}% is below ${(thresholds.openRate * 100).toFixed(2)}%`,
		);
	}

	if (sent > 0 && clickRate < thresholds.clickRate) {
		breaches.push(
			`Click rate ${(clickRate * 100).toFixed(2)}% is below ${(thresholds.clickRate * 100).toFixed(2)}%`,
		);
	}

	let paused = false;
	if (
		options.pauseOnBreach &&
		breaches.length > 0 &&
		(status === "running" || status === "scheduled")
	) {
		await unwrapResponseData(
			await client.campaign.updateStatus({
				path: { id: campaignId },
				body: { status: "paused" },
			}),
			`Failed to pause campaign ${campaignId}`,
		);
		paused = true;
	}

	return {
		campaignId,
		campaignName,
		status,
		checkedAt: new Date().toISOString(),
		metrics: {
			sent,
			toSend,
			views,
			clicks,
			bounces,
			bounceRate,
			openRate,
			clickRate,
		},
		thresholds,
		breaches,
		paused,
	};
}
