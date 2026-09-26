import {
	inspectRenderedCampaignContent,
	isCampaignControlLink,
} from "./campaign-content";
import { pauseCampaign } from "@listmonk-ops/operations";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

import {
	getCampaign,
	getCampaignListIds,
	getListById,
	unwrapResponseData,
} from "./api";
import { extractResults, type RecordValue } from "./core";
import {
	type PinnedHttpSender,
	type ResolvedWebhookAddress,
	sendPinnedHttpRequestWithFallback,
} from "./webhook-transport";

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
	/** Network seams for link checks; production uses DNS and node:http(s). */
	linkCheck?: LinkCheckOptions;
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
	options: LinkCheckOptions,
): Promise<LinkCheckResult[]> {
	const results: LinkCheckResult[] = [];
	const concurrency = 5;
	for (let i = 0; i < urls.length; i += concurrency) {
		const batch = urls.slice(i, i + concurrency);
		const batchResults = await Promise.all(
			batch.map((url) => checkLink(url, timeoutMs, options)),
		);
		results.push(...batchResults);
	}
	return results;
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
 * RFC 6761 reserves `localhost` and every `*.localhost` name for loopback. A
 * trailing root dot (`localhost.`) names the same host.
 */
function isLocalhostName(host: string): boolean {
	let end = host.length;
	while (end > 0 && host.charCodeAt(end - 1) === 0x2e) {
		end -= 1;
	}
	const name = host.slice(0, end);
	return name === "localhost" || name.endsWith(".localhost");
}

/**
 * Returns true for loopback names and literal addresses that are not globally
 * routable. Despite the historical name, this deliberately blocks all
 * special-purpose ranges, including documentation, benchmarking, multicast,
 * and reserved space. Other hostnames are resolved and checked separately.
 */
export function isPrivateHost(hostname: string): boolean {
	const host = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
	if (isLocalhostName(host)) {
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

/** Resolves every address of a hostname; the default uses the system resolver. */
export type HostAddressLookup = (
	hostname: string,
) => Promise<readonly Readonly<{ address: string; family: number }>[]>;

function lookupAllHostAddresses(
	hostname: string,
): Promise<readonly Readonly<{ address: string; family: number }>[]> {
	return dnsLookup(hostname, { all: true, verbatim: true });
}

export type PublicHostResolution =
	| Readonly<{ safe: true; addresses: readonly ResolvedWebhookAddress[] }>
	| Readonly<{ safe: false; reason: string }>;

/**
 * Resolve the addresses that a pinned connection to `url` may use. The URL
 * must pass the static policy and every resolved address must be globally
 * routable. Callers connect only to the returned addresses, so a later lookup
 * cannot rebind the host. Rejects when DNS fails or yields no usable address,
 * so callers fail closed instead of treating an unverified host as safe.
 */
export async function resolvePublicHostAddresses(
	url: string,
	lookupHost: HostAddressLookup = lookupAllHostAddresses,
): Promise<PublicHostResolution> {
	const staticSafety = isSafeFetchUrl(url);
	if (!staticSafety.safe) {
		return { safe: false, reason: staticSafety.reason ?? "URL is not public" };
	}
	const hostname = new URL(url).hostname.replace(/^\[|\]$/gu, "");
	const literalFamily = isIP(hostname);
	const answers =
		literalFamily === 0
			? await lookupHost(hostname)
			: [{ address: hostname, family: literalFamily }];
	if (answers.length === 0) {
		throw new Error(`Host has no DNS addresses: ${hostname}`);
	}
	const addresses: ResolvedWebhookAddress[] = [];
	for (const { address } of answers) {
		const family = isIP(address);
		if (family === 0) {
			throw new Error(`Host resolved to a non-IP address: ${hostname}`);
		}
		if (isPrivateHost(address)) {
			return {
				safe: false,
				reason: `Host ${hostname} resolves to private/internal address ${address}`,
			};
		}
		addresses.push({ address, family: family === 6 ? 6 : 4 });
	}
	return {
		safe: true,
		addresses: addresses.sort((left, right) => left.family - right.family),
	};
}

/**
 * Validate a URL and every address its host currently resolves to. DNS
 * failures fail closed. Validation alone cannot stop DNS rebinding: the later
 * connection must be pinned to the validated addresses, as `checkLink` and
 * webhook delivery do.
 */
export async function isSafeFetchUrlAsync(
	url: string,
): Promise<{ safe: boolean; reason?: string }> {
	try {
		const resolution = await resolvePublicHostAddresses(url);
		return resolution.safe
			? { safe: true }
			: { safe: false, reason: resolution.reason };
	} catch {
		return {
			safe: false,
			reason: `Host ${new URL(url).hostname} could not be resolved`,
		};
	}
}

export interface LinkCheckResult {
	url: string;
	ok: boolean;
	status?: number;
	error?: string;
}

/** Network seams for link checks; tests inject them to avoid real traffic. */
export interface LinkCheckOptions {
	lookupHost?: HostAddressLookup;
	send?: PinnedHttpSender;
}

const MAX_LINK_CHECK_REDIRECTS = 5;
const LINK_CHECK_HEADERS: Readonly<Record<string, string>> = {
	Accept: "*/*",
	"User-Agent": "listmonk-ops-link-check/1",
};
const LOCAL_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/u;

type LinkHopFailure = Readonly<{
	kind: "blocked" | "unverifiable" | "failed";
	reason: string;
}>;
type LinkHopOutcome =
	| Readonly<{ kind: "response"; status: number; location?: string }>
	| LinkHopFailure;

/**
 * Summarize a failure by its runtime error code only. Error messages can carry
 * remote text such as certificate names, so they are never echoed.
 */
function describeErrorCode(error: unknown): string {
	const candidates = error instanceof AggregateError ? error.errors : [error];
	for (const candidate of candidates) {
		const code =
			typeof candidate === "object" && candidate !== null
				? (candidate as { code?: unknown }).code
				: undefined;
		if (typeof code === "string" && LOCAL_ERROR_CODE_PATTERN.test(code)) {
			return ` (${code})`;
		}
	}
	return "";
}

/** Stops waiting on abort; the abandoned promise stays handled. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(signal.reason);
		if (signal.aborted) {
			onAbort();
		} else {
			signal.addEventListener("abort", onAbort, { once: true });
		}
		promise
			.then(resolve, reject)
			.finally(() => signal.removeEventListener("abort", onAbort));
	});
}

/**
 * Validate one hop and, only when every resolved address is public, send the
 * request pinned to those addresses. A host that cannot be resolved makes the
 * hop unverifiable, and nothing is fetched.
 */
async function requestLinkHop(
	url: string,
	method: "GET" | "HEAD",
	signal: AbortSignal,
	timeoutMs: number,
	options: LinkCheckOptions,
): Promise<LinkHopOutcome> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return { kind: "blocked", reason: "invalid URL" };
	}
	if (isCampaignControlLink(parsed)) {
		return { kind: "blocked", reason: "campaign control link" };
	}
	if (parsed.username || parsed.password) {
		return { kind: "blocked", reason: "URL credentials are not allowed" };
	}
	const timedOut: LinkHopFailure = {
		kind: "failed",
		reason: `Timed out after ${timeoutMs}ms`,
	};
	let resolution: PublicHostResolution;
	try {
		resolution = await untilAborted(
			resolvePublicHostAddresses(url, options.lookupHost),
			signal,
		);
	} catch (error) {
		return signal.aborted
			? timedOut
			: {
					kind: "unverifiable",
					reason: `DNS resolution failed for ${parsed.hostname}${describeErrorCode(error)}`,
				};
	}
	if (!resolution.safe) {
		return { kind: "blocked", reason: resolution.reason };
	}
	try {
		const response = await sendPinnedHttpRequestWithFallback(
			{
				url,
				addresses: resolution.addresses,
				method,
				headers: LINK_CHECK_HEADERS,
				signal,
			},
			options.send,
		);
		return { kind: "response", ...response };
	} catch (error) {
		return signal.aborted
			? timedOut
			: { kind: "failed", reason: `Request failed${describeErrorCode(error)}` };
	}
}

function describeLinkHopFailure(
	failure: LinkHopFailure,
	redirected: boolean,
): string {
	if (failure.kind === "failed") {
		return failure.reason;
	}
	const label =
		failure.kind === "blocked"
			? redirected
				? "Redirect blocked"
				: "Blocked"
			: redirected
				? "Redirect unverifiable"
				: "Unverifiable";
	return `${label}: ${failure.reason}`;
}

/**
 * Check one link with HEAD (GET after a 405/501) and at most five manually
 * followed redirects. Every hop is revalidated against the URL policy,
 * resolved once, and connected only to the validated addresses, so DNS
 * rebinding cannot steer a request to a private or metadata address. Hosts
 * that cannot be resolved are reported as unverifiable and never fetched.
 * Results carry policy reasons, status codes, and local error codes only.
 */
export async function checkLink(
	url: string,
	timeoutMs: number,
	options: LinkCheckOptions = {},
): Promise<LinkCheckResult> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	let currentUrl = url;
	let method: "GET" | "HEAD" = "HEAD";
	let redirectCount = 0;
	try {
		for (;;) {
			const hop = await requestLinkHop(
				currentUrl,
				method,
				controller.signal,
				timeoutMs,
				options,
			);
			if (hop.kind !== "response") {
				return {
					url,
					ok: false,
					error: describeLinkHopFailure(hop, redirectCount > 0),
				};
			}
			const { status, location } = hop;
			if (!Number.isInteger(status) || status < 100 || status > 599) {
				return {
					url,
					ok: false,
					error: "Request failed (invalid HTTP status)",
				};
			}
			if (method === "HEAD" && (status === 405 || status === 501)) {
				method = "GET";
				continue;
			}
			if (status < 300 || status >= 400) {
				return { url, ok: status < 400, status };
			}
			if (!location) {
				return {
					url,
					ok: false,
					status,
					error: `Redirect ${status} without Location header`,
				};
			}
			if (redirectCount >= MAX_LINK_CHECK_REDIRECTS) {
				return {
					url,
					ok: false,
					status,
					error: `Exceeded max redirects (${MAX_LINK_CHECK_REDIRECTS})`,
				};
			}
			try {
				currentUrl = new URL(location, currentUrl).toString();
			} catch {
				return {
					url,
					ok: false,
					status,
					error: "Redirect blocked: invalid Location header",
				};
			}
			redirectCount += 1;
		}
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

	let renderedInspection: ReturnType<typeof inspectRenderedCampaignContent> | undefined;
	try {
		const rendered = unwrapResponseData(
			await client.campaign.preview({ path: { id: campaignId } }),
			"Failed to render campaign preview",
		);
		if (typeof rendered !== "string") throw new Error("Invalid campaign preview response");
		renderedInspection = inspectRenderedCampaignContent(rendered, campaign.content_type);
		checks.push({
			id: "template_tokens",
			level: "pass",
			message: "Campaign and template rendered successfully for the preview subscriber",
		});
		checks.push({
			id: "unsubscribe_link",
			level: renderedInspection.hasUnsubscribeLink ? "pass" : "fail",
			message: renderedInspection.hasUnsubscribeLink
				? "Native unsubscribe link found in rendered campaign content"
				: "Native unsubscribe link not found in rendered campaign content",
		});
	} catch {
		// Preview errors can embed recipient or template content; do not echo them.
		checks.push({
			id: "template_tokens",
			level: "fail",
			message: "Campaign preview failed or returned invalid content; inspect the preview in Listmonk",
		});
		checks.push({
			id: "unsubscribe_link",
			level: "fail",
			message: "Unable to verify unsubscribe link without a valid rendered preview",
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
		const links = renderedInspection?.linksToCheck.slice(0, 20) ?? [];
		if (links.length === 0) {
			checks.push({
				id: "link_health",
				level: "warn",
				message: "No ordinary http(s) links to check in rendered campaign content (control links are skipped)",
				details: {
					skippedControlLinks: renderedInspection?.skippedControlLinks ?? 0,
				},
			});
		} else {
			const linkResults = await checkLinksWithBoundedConcurrency(
				links,
				linkCheckTimeoutMs,
				options.linkCheck ?? {},
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
					skippedControlLinks: renderedInspection?.skippedControlLinks ?? 0,
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

export const DEFAULT_ENGAGEMENT_OBSERVATION_SECONDS = 3_600;

export interface DeliverabilityGuardOptions {
	bounceThreshold?: number;
	openRateThreshold?: number;
	clickRateThreshold?: number;
	pauseOnBreach?: boolean;
	/** Minimum sent count before engagement breaches are evaluated (default 100). */
	minimumSent?: number;
	/** Minimum campaign age before evaluating engagement (default one hour). */
	minimumObservationSeconds?: number;
	/** Engagement remains advisory unless both pause flags are explicit. */
	pauseOnEngagementBreach?: boolean;
	now?: () => Date;
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

function strictCampaignStartMs(value: unknown): number | undefined {
	if (typeof value !== "string") return undefined;
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/u.exec(
		value,
	);
	if (!match) return undefined;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	const daysInMonth = [
		31,
		leap ? 29 : 28,
		31,
		30,
		31,
		30,
		31,
		31,
		30,
		31,
		30,
		31,
	];
	if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]!
		|| Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59
		|| (match[8] !== undefined && (Number(match[8]) > 23 || Number(match[9]) > 59))) return undefined;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : undefined;
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
	const minimumObservationSeconds = options.minimumObservationSeconds ?? DEFAULT_ENGAGEMENT_OBSERVATION_SECONDS;
	if (!Number.isInteger(minimumObservationSeconds) || minimumObservationSeconds < 1 || minimumObservationSeconds > 31_536_000) {
		throw new RangeError(
			"minimumObservationSeconds must be between 1 and 31536000",
		);
	}
	const now = options.now?.() ?? new Date();
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

	const startedAt = strictCampaignStartMs(campaign.started_at);
	const engagementReady = sent >= minimumSent && startedAt !== undefined
		&& now.getTime() - startedAt >= minimumObservationSeconds * 1_000;
	const bounceBreach = bounceRate > thresholds.bounceRate;
	const engagementBreach = engagementReady && (openRate < thresholds.openRate || clickRate < thresholds.clickRate);
	const breaches: string[] = [];
	if (bounceBreach) {
		breaches.push(
			`Bounce rate ${(bounceRate * 100).toFixed(2)}% is above ${(thresholds.bounceRate * 100).toFixed(2)}%`,
		);
	}

	// Wait for both volume and observation time. Missing/future timestamps
	// cannot authorize engagement actions, and engagement is advisory by default.
	if (engagementReady && openRate < thresholds.openRate) {
		breaches.push(
			`Open rate ${(openRate * 100).toFixed(2)}% is below ${(thresholds.openRate * 100).toFixed(2)}%`,
		);
	}

	if (engagementReady && clickRate < thresholds.clickRate) {
		breaches.push(
			`Click rate ${(clickRate * 100).toFixed(2)}% is below ${(thresholds.clickRate * 100).toFixed(2)}%`,
		);
	}

	let paused = false;
	if (options.pauseOnBreach && status === "running"
		&& (bounceBreach || (options.pauseOnEngagementBreach && engagementBreach))) {
		if (!campaign.updated_at?.trim()) {
			throw new Error(
				"Cannot pause campaign without an observed updated_at revision",
			);
		}
		// Reuse the shared legal-transition and revision checks; never bypass them.
		await pauseCampaign(
			{ client },
			{ id: campaignId, expected_updated_at: campaign.updated_at },
		);
		paused = true;
	}

	return {
		campaignId,
		campaignName,
		status,
		checkedAt: now.toISOString(),
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
