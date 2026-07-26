import type { ListmonkClient } from "@listmonk-ops/openapi";
import { lookup as dnsLookup } from "node:dns/promises";

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

const LINK_LOCAL_PREFIXES = ["fe8", "fe9", "fea", "feb"];

/**
 * Check links with bounded concurrency (max 5 at a time) to avoid
 * overwhelming the server or the network.
 */
async function checkLinksWithBoundedConcurrency(
	urls: string[],
	timeoutMs: number,
): Promise<Array<{ url: string; ok: boolean; status?: number; error?: string }>> {
	const results: Array<{ url: string; ok: boolean; status?: number; error?: string }> = [];
	const concurrency = 5;
	for (let i = 0; i < urls.length; i += concurrency) {
		const batch = urls.slice(i, i + concurrency);
		const batchResults = await Promise.all(
			batch.map((url) => checkLink(url, timeoutMs)),
		);
		results.push(...batchResults);
	}
	return results;
}

function collectBodyLinks(body: string): string[] {
	const matches = body.match(/https?:\/\/[^\s"'<>()]+/g) || [];
	return Array.from(new Set(matches));
}

/**
 * Check whether a URL's hostname resolves to a private or internal address.
 * Blocks loopback (127.x, ::1), private CIDRs (10.x, 172.16-31.x,
 * 192.168.x), link-local (169.254.x, fe80::), and cloud metadata IPs
 * (169.254.169.254) to prevent SSRF via campaign body content.
 */
export function isPrivateHost(hostname: string): boolean {
	const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
	const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	const checkHost = mapped ? mapped[1]! : host;
	const parts = checkHost.split(".");
	if (parts.length === 4) {
		const nums = parts.map((p) => parseInt(p, 10));
		if (nums.length === 4 && nums.every((n) => n >= 0 && n <= 255)) {
			const a = nums[0]!;
			const b = nums[1]!;
			if (a === 127 || a === 10 || a === 0) return true;
			if (a === 172 && b >= 16 && b <= 31) return true;
			if (a === 192 && b === 168) return true;
			if (a === 169 && b === 254) return true;
			return false;
		}
	}
	if (host === "::1" || host === "localhost") return true;
	if (host.includes("::")) {
		if (host.startsWith("fc") || host.startsWith("fd")) return true;
		if (LINK_LOCAL_PREFIXES.some((p) => host.startsWith(p))) return true;
	}
	return false;
}

/**
 * Validate that a URL is safe to fetch: must be http(s), not target a
 * private/internal host.
 */
export function isSafeFetchUrl(url: string): { safe: boolean; reason?: string } {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return { safe: false, reason: "Invalid URL" };
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return { safe: false, reason: `Protocol ${parsed.protocol} not allowed` };
	}
	if (isPrivateHost(parsed.hostname)) {
		return {
			safe: false,
			reason: `Host ${parsed.hostname} is private/internal`,
		};
	}
	return { safe: true };
}

/**
 * Resolve a hostname via DNS and check every resolved address against
 * isPrivateHost. This prevents DNS rebinding attacks where a hostname
 * like "evil.com" resolves to 127.0.0.1 or an internal IP.
 *
 * Uses Node's dns.promises.lookup which Bun supports. Falls open if
 * resolution fails (e.g. localhost with no DNS entry) because the
 * hostname-only check above already handles literal private IPs.
 */
async function isSafeResolvedHost(hostname: string): Promise<{ safe: boolean; reason?: string }> {
	let addresses: Array<{ address: string }>;
	try {
		addresses = await dnsLookup(hostname, { all: true });
	} catch {
		// DNS resolution failed — the hostname-only check already caught
		// literal private IPs. If it's a public hostname that doesn't
		// resolve, the fetch will fail anyway. Allow it.
		return { safe: true };
	}
	for (const addr of addresses) {
		if (isPrivateHost(addr.address)) {
			return {
				safe: false,
				reason: `Host ${hostname} resolves to private/internal address ${addr.address}`,
			};
		}
	}
	return { safe: true };
}

/**
 * Asynchronously validate that a URL is safe to fetch: must be http(s),
 * not target a private/internal host, and the hostname must not resolve
 * to a private/internal IP (DNS rebinding defense).
 */
export async function isSafeFetchUrlAsync(url: string): Promise<{ safe: boolean; reason?: string }> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return { safe: false, reason: "Invalid URL" };
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return { safe: false, reason: `Protocol ${parsed.protocol} not allowed` };
	}
	if (isPrivateHost(parsed.hostname)) {
		return {
			safe: false,
			reason: `Host ${parsed.hostname} is private/internal`,
		};
	}
	// DNS resolution pinning: resolve and check every address.
	const resolved = await isSafeResolvedHost(parsed.hostname);
	if (!resolved.safe) {
		return resolved;
	}
	return { safe: true };
}

export async function checkLink(
	url: string,
	timeoutMs: number,
): Promise<{
	url: string;
	ok: boolean;
	status?: number;
	error?: string;
}> {
	// SSRF defense: reject private/internal hosts before fetching,
	// including DNS resolution pinning.
	const safety = await isSafeFetchUrlAsync(url);
	if (!safety.safe) {
		return { url, ok: false, error: `Blocked: ${safety.reason}` };
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	const maxRedirects = 5;
	let currentUrl = url;
	let redirectCount = 0;

	try {
		let response = await fetch(currentUrl, {
			method: "HEAD",
			redirect: "manual",
			signal: controller.signal,
		});

		const headResult = await followRedirects(
			response,
			"HEAD",
			currentUrl,
			redirectCount,
			maxRedirects,
			controller,
		);
		if (headResult.error) {
			return { url, ok: false, error: headResult.error };
		}
		response = headResult.response;
		currentUrl = headResult.currentUrl;
		redirectCount = headResult.redirectCount;

		if (response.status === 405 || response.status === 501) {
			response.body?.cancel().catch(() => {});
			response = await fetch(currentUrl, {
				method: "GET",
				redirect: "manual",
				signal: controller.signal,
			});
			const getResult = await followRedirects(
				response,
				"GET",
				currentUrl,
				redirectCount,
				maxRedirects,
				controller,
			);
			if (getResult.error) {
				return { url, ok: false, error: getResult.error };
			}
			response = getResult.response;
			currentUrl = getResult.currentUrl;
			redirectCount = getResult.redirectCount;
		}

		// If a 3xx remains after followRedirects, distinguish between
		// budget exhaustion and a Location-less 3xx.
		if (response.status >= 300 && response.status < 400) {
			const hasLocation = response.headers.get("location");
			const reason =
				redirectCount >= maxRedirects
					? `Exceeded max redirects (${maxRedirects})`
					: hasLocation
						? `Unexpected redirect state`
						: `Redirect ${response.status} without Location header`;
			return {
				url,
				ok: false,
				status: response.status,
				error: reason,
			};
		}

		response.body?.cancel().catch(() => {});
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

/**
 * Shared redirect-following loop with per-hop SSRF revalidation.
 * Used by both HEAD and GET paths in checkLink.
 */
async function followRedirects(
	response: Response,
	method: string,
	currentUrl: string,
	redirectCount: number,
	maxRedirects: number,
	controller: AbortController,
): Promise<{
	response: Response;
	currentUrl: string;
	redirectCount: number;
	error?: string;
}> {
	while (
		response.status >= 300 &&
		response.status < 400 &&
		response.headers.get("location") &&
		redirectCount < maxRedirects
	) {
		const location = response.headers.get("location")!;
		response.body?.cancel().catch(() => {});
		currentUrl = new URL(location, currentUrl).toString();
		const redirectSafety = await isSafeFetchUrlAsync(currentUrl);
		if (!redirectSafety.safe) {
			return {
				response,
				currentUrl,
				redirectCount,
				error: `Redirect blocked: ${redirectSafety.reason}`,
			};
		}
		redirectCount += 1;
		response = await fetch(currentUrl, {
			method,
			redirect: "manual",
			signal: controller.signal,
		});
	}
	return { response, currentUrl, redirectCount };
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
			const linkResults = await checkLinksWithBoundedConcurrency(
				links,
				linkCheckTimeoutMs,
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
	/** Minimum sent count before engagement breaches are evaluated (default 100). */
	minimumSent?: number;
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
	const minimumSent = options.minimumSent ?? 100;
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

	// Engagement breaches (open/click rate) only evaluated when enough sends
	// have accumulated. Low-volume early sends produce noisy rates.
	if (sent >= minimumSent && openRate < thresholds.openRate) {
		breaches.push(
			`Open rate ${(openRate * 100).toFixed(2)}% is below ${(thresholds.openRate * 100).toFixed(2)}%`,
		);
	}

	if (sent >= minimumSent && clickRate < thresholds.clickRate) {
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
