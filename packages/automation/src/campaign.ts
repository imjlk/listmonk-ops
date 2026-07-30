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
	/** Listmonk revision token that delivery operations must re-check. */
	campaignUpdatedAt: string;
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
 * Check whether a URL hostname is a literal address that is not globally
 * routable. This includes private, loopback, link-local, documentation,
 * benchmarking, multicast, and reserved ranges.
 */
type Ipv4Range = readonly [network: number, prefixLength: number];

const NON_PUBLIC_IPV4_RANGES: readonly Ipv4Range[] = [
	[0x00000000, 8], // current network
	[0x0a000000, 8], // private
	[0x64400000, 10], // shared address space
	[0x7f000000, 8], // loopback
	[0xa9fe0000, 16], // link-local
	[0xac100000, 12], // private
	[0xc0000000, 24], // IETF protocol assignments
	[0xc0000200, 24], // TEST-NET-1
	[0xc0586300, 24], // deprecated 6to4 relay anycast
	[0xc0a80000, 16], // private
	[0xc6120000, 15], // benchmarking
	[0xc6336400, 24], // TEST-NET-2
	[0xcb007100, 24], // TEST-NET-3
	[0xe0000000, 4], // multicast
	[0xf0000000, 4], // reserved and limited broadcast
] as const;

function parseIpv4Address(value: string): number | undefined {
	const parts = value.split(".");
	if (
		parts.length !== 4 ||
		parts.some((part) => !/^(?:0|[1-9]\d{0,2})$/u.test(part))
	) {
		return undefined;
	}
	const octets = parts.map(Number);
	if (octets.some((octet) => octet > 255)) {
		return undefined;
	}
	return (
		((octets[0]! << 24) |
			(octets[1]! << 16) |
			(octets[2]! << 8) |
			octets[3]!) >>>
		0
	);
}

function isIpv4InRange(
	address: number,
	[network, prefixLength]: Ipv4Range,
): boolean {
	const mask =
		prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
	return (address & mask) >>> 0 === (network & mask) >>> 0;
}

function isPublicIpv4(address: number): boolean {
	return !NON_PUBLIC_IPV4_RANGES.some((range) => isIpv4InRange(address, range));
}

function parseIpv6Address(value: string): bigint | undefined {
	let normalized = value.toLowerCase();
	const zoneIndex = normalized.indexOf("%");
	if (zoneIndex >= 0) {
		normalized = normalized.slice(0, zoneIndex);
	}
	const ipv4Tail = /(?:^|:)(\d+\.\d+\.\d+\.\d+)$/u.exec(normalized);
	if (ipv4Tail) {
		const ipv4 = parseIpv4Address(ipv4Tail[1]!);
		if (ipv4 === undefined) {
			return undefined;
		}
		normalized = `${normalized.slice(0, -ipv4Tail[1]!.length)}${(
			(ipv4 >>> 16) &
			0xffff
		).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
	}
	const halves = normalized.split("::");
	if (halves.length > 2) {
		return undefined;
	}
	const left = halves[0] ? halves[0].split(":") : [];
	const right = halves[1] ? halves[1].split(":") : [];
	const missing = 8 - left.length - right.length;
	if (
		(halves.length === 1 && missing !== 0) ||
		(halves.length === 2 && missing < 1)
	) {
		return undefined;
	}
	const parts = [
		...left,
		...Array.from({ length: Math.max(0, missing) }, () => "0"),
		...right,
	];
	if (
		parts.length !== 8 ||
		parts.some((part) => !/^[0-9a-f]{1,4}$/u.test(part))
	) {
		return undefined;
	}
	return parts.reduce(
		(result, part) => (result << 16n) | BigInt(`0x${part}`),
		0n,
	);
}

function isIpv6InRange(
	address: bigint,
	network: bigint,
	prefixLength: number,
): boolean {
	const shift = BigInt(128 - prefixLength);
	return address >> shift === network >> shift;
}

function isPublicIpv6(address: bigint): boolean {
	const mappedPrefix = address >> 32n;
	if (mappedPrefix === 0xffffn) {
		return isPublicIpv4(Number(address & 0xffffffffn));
	}
	if (!isIpv6InRange(address, 0x20000000000000000000000000000000n, 3)) {
		return false;
	}
	const nonPublicRanges: readonly (readonly [
		network: bigint,
		prefixLength: number,
	])[] = [
		[0x20010000000000000000000000000000n, 23],
		[0x20010db8000000000000000000000000n, 32],
		[0x20020000000000000000000000000000n, 16],
		[0x3fff0000000000000000000000000000n, 20],
	];
	return !nonPublicRanges.some(([network, prefixLength]) =>
		isIpv6InRange(address, network, prefixLength),
	);
}

/**
 * Returns true for literal addresses that are not globally routable. Despite
 * the historical name, this deliberately blocks all special-purpose ranges,
 * including documentation, benchmarking, multicast, and reserved space.
 * Non-literal hostnames are resolved and checked separately.
 */
export function isPrivateHost(hostname: string): boolean {
	const host = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
	if (host === "localhost") {
		return true;
	}
	const ipv4 = parseIpv4Address(host);
	if (ipv4 !== undefined) {
		return !isPublicIpv4(ipv4);
	}
	const ipv6 = parseIpv6Address(host);
	return ipv6 === undefined ? false : !isPublicIpv6(ipv6);
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
	const campaignUpdatedAt = campaign.updated_at?.trim();
	if (!campaignUpdatedAt) {
		throw new Error(
			`Campaign ${campaignId} is missing updated_at; cannot create a preflight revision token`,
		);
	}
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
		campaignUpdatedAt,
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
