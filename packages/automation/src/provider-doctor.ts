import type { ListmonkClient } from "@listmonk-ops/openapi";
import { resolveCname, resolveMx, resolveTxt } from "node:dns/promises";
import type {
	ProviderInspector,
	ProviderProfile,
	SesAccountSnapshot,
	SesIdentitySnapshot,
} from "./provider-profiles";

const DEFAULT_DNS_TIMEOUT_MS = 5_000;

export type DoctorCheckStatus = "pass" | "warn" | "fail" | "unknown";

export interface DoctorCheck {
	id: string;
	status: DoctorCheckStatus;
	message: string;
	details?: Readonly<Record<string, unknown>> | undefined;
}

export interface ProviderProfileSummary {
	id: string;
	kind: ProviderProfile["kind"];
	messenger: string;
	sending_domain: string;
	from_email?: string | undefined;
	region?: string | undefined;
	smtp_hosts: string[];
	webhook_source: string;
	credential_reference_configured: boolean;
}

export interface ProviderListmonkSnapshot {
	from_email?: string | undefined;
	from_domain?: string | undefined;
	messenger: string;
	smtp_hosts: string[];
	matching_smtp_hosts: string[];
	smtp_configured: boolean;
	smtp_enabled: boolean;
	unsubscribe_header_enabled: boolean;
	bounce_processing_enabled: boolean;
	bounce_webhooks_enabled: boolean;
	provider_bounce_enabled?: boolean | undefined;
}

export interface ProviderApiProbe {
	supported: boolean;
	reachable: boolean;
	authenticated: boolean;
	latency_ms?: number | undefined;
	error_code?: string | undefined;
	error_message?: string | undefined;
}

export interface ProviderStatusSnapshot {
	provider: ProviderProfileSummary;
	health: "healthy" | "degraded" | "unavailable";
	checked_at: string;
	api: ProviderApiProbe;
	account?: SesAccountSnapshot | undefined;
	identity?: SesIdentitySnapshot | undefined;
	listmonk?: ProviderListmonkSnapshot | undefined;
	checks: DoctorCheck[];
}

export interface ProviderQuotaSnapshot {
	provider_id: string;
	supported: boolean;
	checked_at: string;
	max_24_hour_send?: number | undefined;
	max_send_rate?: number | undefined;
	sent_last_24_hours?: number | undefined;
	remaining_24_hours?: number | undefined;
	utilization_percent?: number | undefined;
	production_access_enabled?: boolean | undefined;
	sending_enabled?: boolean | undefined;
	enforcement_status?: string | undefined;
}

export interface ProviderWebhookSnapshot {
	provider_id: string;
	source: string;
	checked_at: string;
	max_age_hours: number;
	bounce_processing_enabled: boolean;
	bounce_webhooks_enabled: boolean;
	provider_bounce_enabled?: boolean | undefined;
	last_event_at?: string | undefined;
	last_event_type?: string | undefined;
	freshness: "fresh" | "stale" | "unknown";
	healthy: boolean;
	checks: DoctorCheck[];
}

export interface DnsObservation {
	name: string;
	type: "TXT" | "CNAME" | "MX";
	values: string[];
	error?: string | undefined;
}

export interface ProviderDnsSnapshot {
	provider_id: string;
	sending_domain: string;
	from_domain: string;
	mail_from_domain?: string | undefined;
	checked_at: string;
	observations: DnsObservation[];
	checks: DoctorCheck[];
	healthy: boolean;
}

export interface ProviderDoctorSnapshot {
	provider_id: string;
	checked_at: string;
	ready: boolean;
	summary: {
		pass: number;
		warn: number;
		fail: number;
		unknown: number;
	};
	status: ProviderStatusSnapshot;
	quota: ProviderQuotaSnapshot;
	webhook: ProviderWebhookSnapshot;
	dns: ProviderDnsSnapshot;
	checks: DoctorCheck[];
}

export interface ProviderDnsResolver {
	txt(name: string): Promise<string[]>;
	cname(name: string): Promise<string[]>;
	mx(name: string): Promise<Array<{ exchange: string; priority: number }>>;
}

export interface ProviderInspectionContext {
	client?: Pick<ListmonkClient, "settings" | "bounce"> | undefined;
	inspector?: ProviderInspector | undefined;
	dns?: ProviderDnsResolver | undefined;
	now?: (() => Date) | undefined;
}

function errorMessage(error: unknown): string {
	const raw = error instanceof Error ? error.message : String(error);
	return raw
		.replace(/(https?:\/\/)[^/@\s]+@/gi, "$1[redacted]@")
		.replace(/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, "[redacted-aws-access-key]")
		.slice(0, 500);
}

function errorCode(error: unknown): string {
	if (
		typeof error === "object" &&
		error !== null &&
		"name" in error &&
		typeof error.name === "string"
	) {
		return error.name.slice(0, 120);
	}
	return "ProviderInspectionError";
}

function providerApiFailureMessage(
	profile: ProviderProfile,
	error: unknown,
): string {
	return `${profile.kind.toUpperCase()} provider inspection failed (${errorCode(error)}). Check the configured credential reference and provider permissions.`;
}

function fromDomain(fromEmail: string | undefined, fallback: string): string {
	if (!fromEmail) return fallback;
	const match = /@([^>\s]+)>?$/.exec(fromEmail.trim());
	return match?.[1]?.toLowerCase().replace(/\.$/, "") ?? fallback;
}

function aligned(left: string, right: string): boolean {
	const normalizedLeft = left.toLowerCase().replace(/\.$/, "");
	const normalizedRight = right.toLowerCase().replace(/\.$/, "");
	return (
		normalizedLeft === normalizedRight ||
		normalizedLeft.endsWith(`.${normalizedRight}`) ||
		normalizedRight.endsWith(`.${normalizedLeft}`)
	);
}

function profileWebhookSource(profile: ProviderProfile): string {
	return profile.webhook_source ?? profile.kind;
}

export function summarizeProviderProfile(
	profile: ProviderProfile,
): ProviderProfileSummary {
	return {
		id: profile.id,
		kind: profile.kind,
		messenger: profile.messenger,
		sending_domain: profile.sending_domain,
		...(profile.from_email === undefined
			? {}
			: { from_email: profile.from_email }),
		...(profile.region === undefined ? {} : { region: profile.region }),
		smtp_hosts: [...profile.smtp_hosts],
		webhook_source: profileWebhookSource(profile),
		credential_reference_configured: profile.secret_ref !== undefined,
	};
}

function settingBoolean(
	settings: Readonly<Record<string, unknown>>,
	key: string,
): boolean {
	return settings[key] === true;
}

function smtpRecords(
	settings: Readonly<Record<string, unknown>>,
): ReadonlyArray<Readonly<Record<string, unknown>>> {
	const value = settings.smtp;
	if (!Array.isArray(value)) return [];
	return value.filter(
		(entry): entry is Readonly<Record<string, unknown>> =>
			typeof entry === "object" && entry !== null,
	);
}

function smtpHost(record: Readonly<Record<string, unknown>>): string | undefined {
	return typeof record.host === "string"
		? record.host.toLowerCase().replace(/\.$/, "")
		: undefined;
}

function expectedSmtpHosts(profile: ProviderProfile): string[] {
	if (profile.smtp_hosts.length > 0) return [...profile.smtp_hosts];
	if (profile.kind === "ses" && profile.region) {
		return [`email-smtp.${profile.region}.amazonaws.com`];
	}
	return [];
}

export function inspectListmonkProviderSettings(
	profile: ProviderProfile,
	settings: Readonly<Record<string, unknown>>,
): ProviderListmonkSnapshot {
	const expectedHosts = expectedSmtpHosts(profile);
	const smtp = smtpRecords(settings);
	const matching = smtp.filter((record) => {
		const host = smtpHost(record);
		return host !== undefined && expectedHosts.includes(host);
	});
	const configuredFrom =
		typeof settings["app.from_email"] === "string"
			? settings["app.from_email"]
			: undefined;

	return {
		...(configuredFrom === undefined ? {} : { from_email: configuredFrom }),
		from_domain: fromDomain(configuredFrom, profile.sending_domain),
		messenger: profile.messenger,
		smtp_hosts: smtp
			.map(smtpHost)
			.filter((host): host is string => host !== undefined),
		matching_smtp_hosts: matching
			.map(smtpHost)
			.filter((host): host is string => host !== undefined),
		smtp_configured: matching.length > 0,
		smtp_enabled: matching.some((record) => record.enabled !== false),
		unsubscribe_header_enabled: settingBoolean(
			settings,
			"privacy.unsubscribe_header",
		),
		bounce_processing_enabled: settingBoolean(settings, "bounce.enabled"),
		bounce_webhooks_enabled: settingBoolean(
			settings,
			"bounce.webhooks_enabled",
		),
		...(profile.kind === "ses"
			? {
					provider_bounce_enabled: settingBoolean(
						settings,
						"bounce.ses_enabled",
					),
				}
			: {}),
	};
}

async function readListmonkSettings(
	context: ProviderInspectionContext,
): Promise<Readonly<Record<string, unknown>>> {
	if (!context.client) {
		throw new TypeError("Listmonk client is required for provider inspection");
	}
	const result = await context.client.settings.get();
	return result.data as Readonly<Record<string, unknown>>;
}

function settingsChecks(
	profile: ProviderProfile,
	snapshot: ProviderListmonkSnapshot,
): DoctorCheck[] {
	const checks: DoctorCheck[] = [
		{
			id: "listmonk.smtp",
			status:
				snapshot.smtp_configured && snapshot.smtp_enabled ? "pass" : "fail",
			message:
				snapshot.smtp_configured && snapshot.smtp_enabled
					? "A matching enabled SMTP entry is configured in Listmonk."
					: "No matching enabled SMTP entry is configured in Listmonk.",
			details: {
				expected_hosts: expectedSmtpHosts(profile),
				matching_hosts: snapshot.matching_smtp_hosts,
			},
		},
		{
			id: "listmonk.from-alignment",
			status:
				snapshot.from_domain &&
				aligned(snapshot.from_domain, profile.sending_domain)
					? "pass"
					: "fail",
			message:
				snapshot.from_domain &&
				aligned(snapshot.from_domain, profile.sending_domain)
					? "Listmonk From domain aligns with the provider sending domain."
					: "Listmonk From domain does not align with the provider sending domain.",
			details: {
				from_domain: snapshot.from_domain,
				sending_domain: profile.sending_domain,
			},
		},
		{
			id: "listmonk.unsubscribe-header",
			status: snapshot.unsubscribe_header_enabled ? "pass" : "fail",
			message: snapshot.unsubscribe_header_enabled
				? "List-Unsubscribe headers are enabled."
				: "List-Unsubscribe headers are disabled.",
		},
		{
			id: "listmonk.bounce-processing",
			status: snapshot.bounce_processing_enabled ? "pass" : "fail",
			message: snapshot.bounce_processing_enabled
				? "Bounce processing is enabled."
				: "Bounce processing is disabled.",
		},
		{
			id: "listmonk.bounce-webhooks",
			status: snapshot.bounce_webhooks_enabled ? "pass" : "fail",
			message: snapshot.bounce_webhooks_enabled
				? "Bounce webhooks are enabled."
				: "Bounce webhooks are disabled.",
		},
	];
	if (snapshot.provider_bounce_enabled !== undefined) {
		checks.push({
			id: `listmonk.bounce-provider.${profile.kind}`,
			status: snapshot.provider_bounce_enabled ? "pass" : "fail",
			message: snapshot.provider_bounce_enabled
				? `${profile.kind.toUpperCase()} bounce handling is enabled.`
				: `${profile.kind.toUpperCase()} bounce handling is disabled.`,
		});
	}
	return checks;
}

function accountChecks(account: SesAccountSnapshot): DoctorCheck[] {
	return [
		{
			id: "provider.sending-enabled",
			status: account.sending_enabled === true ? "pass" : "fail",
			message:
				account.sending_enabled === true
					? "Provider sending is enabled."
					: "Provider sending is disabled.",
		},
		{
			id: "provider.production-access",
			status: account.production_access_enabled === true ? "pass" : "warn",
			message:
				account.production_access_enabled === true
					? "SES production access is enabled."
					: "SES account is still in the sandbox.",
		},
		{
			id: "provider.enforcement",
			status:
				account.enforcement_status === "HEALTHY"
					? "pass"
					: account.enforcement_status === undefined
						? "unknown"
						: "fail",
			message:
				account.enforcement_status === undefined
					? "SES enforcement status was not returned."
					: `SES enforcement status is ${account.enforcement_status}.`,
		},
	];
}

function identityChecks(identity: SesIdentitySnapshot): DoctorCheck[] {
	return [
		{
			id: "provider.identity-verified",
			status: identity.verified_for_sending === true ? "pass" : "fail",
			message:
				identity.verified_for_sending === true
					? "SES identity is verified for sending."
					: "SES identity is not verified for sending.",
		},
		{
			id: "provider.dkim",
			status:
				identity.dkim_signing_enabled === true &&
				identity.dkim_status === "SUCCESS"
					? "pass"
					: "fail",
			message:
				identity.dkim_signing_enabled === true &&
				identity.dkim_status === "SUCCESS"
					? "SES DKIM signing is enabled and verified."
					: `SES DKIM is not ready (${identity.dkim_status ?? "unknown"}).`,
		},
		{
			id: "provider.mail-from",
			status:
				identity.mail_from_domain === undefined
					? "warn"
					: identity.mail_from_status === "SUCCESS"
						? "pass"
						: "fail",
			message:
				identity.mail_from_domain === undefined
					? "SES uses its default MAIL FROM domain; SPF will not align with the From domain."
					: `SES custom MAIL FROM status is ${identity.mail_from_status ?? "unknown"}.`,
			details:
				identity.mail_from_domain === undefined
					? undefined
					: { mail_from_domain: identity.mail_from_domain },
		},
	];
}

export async function inspectProviderStatus(
	profile: ProviderProfile,
	context: ProviderInspectionContext,
): Promise<ProviderStatusSnapshot> {
	const now = context.now?.() ?? new Date();
	const startedAt = Date.now();
	let account: SesAccountSnapshot | undefined;
	let identity: SesIdentitySnapshot | undefined;
	let api: ProviderApiProbe;

	if (profile.kind !== "ses" || context.inspector === undefined) {
		api = {
			supported: false,
			reachable: false,
			authenticated: false,
		};
	} else {
		try {
			[account, identity] = await Promise.all([
				context.inspector.inspectAccount(),
				context.inspector.inspectIdentity(),
			]);
			api = {
				supported: true,
				reachable: true,
				authenticated: true,
				latency_ms: Math.max(0, Date.now() - startedAt),
			};
		} catch (error) {
			api = {
				supported: true,
				reachable: false,
				authenticated: false,
				latency_ms: Math.max(0, Date.now() - startedAt),
				error_code: errorCode(error),
				error_message: providerApiFailureMessage(profile, error),
			};
		}
	}

	let listmonk: ProviderListmonkSnapshot | undefined;
	const checks: DoctorCheck[] = [];
	try {
		listmonk = inspectListmonkProviderSettings(
			profile,
			await readListmonkSettings(context),
		);
		checks.push(...settingsChecks(profile, listmonk));
	} catch (error) {
		checks.push({
			id: "listmonk.settings",
			status: "fail",
			message: `Failed to inspect Listmonk settings: ${errorMessage(error)}`,
		});
	}
	if (account) checks.push(...accountChecks(account));
	if (identity) checks.push(...identityChecks(identity));
	if (profile.kind === "ses" && !api.authenticated) {
		checks.push({
			id: "provider.api",
			status: "fail",
			message:
				api.error_message ??
				"SES account and identity inspection could not be completed.",
		});
	}
	if (profile.kind === "smtp") {
		checks.push({
			id: "provider.api",
			status: "unknown",
			message:
				"Generic SMTP has no read-only provider API adapter; Listmonk and DNS checks remain available.",
		});
	}

	const failed = checks.some(({ status }) => status === "fail");
	const degraded = checks.some(
		({ status }) => status === "warn" || status === "unknown",
	);
	return {
		provider: summarizeProviderProfile(profile),
		health: failed ? "unavailable" : degraded ? "degraded" : "healthy",
		checked_at: now.toISOString(),
		api,
		...(account === undefined ? {} : { account }),
		...(identity === undefined ? {} : { identity }),
		...(listmonk === undefined ? {} : { listmonk }),
		checks,
	};
}

export async function testProviderApi(
	profile: ProviderProfile,
	context: ProviderInspectionContext,
): Promise<ProviderApiProbe> {
	if (profile.kind !== "ses" || context.inspector === undefined) {
		return {
			supported: false,
			reachable: false,
			authenticated: false,
		};
	}
	const startedAt = Date.now();
	try {
		await context.inspector.inspectAccount();
		return {
			supported: true,
			reachable: true,
			authenticated: true,
			latency_ms: Math.max(0, Date.now() - startedAt),
		};
	} catch (error) {
		return {
			supported: true,
			reachable: false,
			authenticated: false,
			latency_ms: Math.max(0, Date.now() - startedAt),
			error_code: errorCode(error),
			error_message: providerApiFailureMessage(profile, error),
		};
	}
}

export async function inspectProviderQuota(
	profile: ProviderProfile,
	context: ProviderInspectionContext,
): Promise<ProviderQuotaSnapshot> {
	const checkedAt = (context.now?.() ?? new Date()).toISOString();
	if (profile.kind !== "ses" || context.inspector === undefined) {
		return {
			provider_id: profile.id,
			supported: false,
			checked_at: checkedAt,
		};
	}
	const account = await context.inspector.inspectAccount();
	const max = account.max_24_hour_send;
	const sent = account.sent_last_24_hours;
	const unlimited = max === -1;
	const remaining =
		max === undefined || sent === undefined
			? undefined
			: unlimited
				? -1
				: Math.max(0, max - sent);
	const utilization =
		max === undefined || sent === undefined || max <= 0
			? undefined
			: Math.min(100, Math.max(0, (sent / max) * 100));
	return {
		provider_id: profile.id,
		supported: true,
		checked_at: checkedAt,
		max_24_hour_send: max,
		max_send_rate: account.max_send_rate,
		sent_last_24_hours: sent,
		remaining_24_hours: remaining,
		utilization_percent:
			utilization === undefined ? undefined : Number(utilization.toFixed(2)),
		production_access_enabled: account.production_access_enabled,
		sending_enabled: account.sending_enabled,
		enforcement_status: account.enforcement_status,
	};
}

function bounceItems(result: unknown): ReadonlyArray<Readonly<Record<string, unknown>>> {
	if (typeof result !== "object" || result === null) return [];
	const data = (result as { data?: unknown }).data;
	if (typeof data !== "object" || data === null) return [];
	const results = (data as { results?: unknown }).results;
	if (!Array.isArray(results)) return [];
	return results.filter(
		(item): item is Readonly<Record<string, unknown>> =>
			typeof item === "object" && item !== null,
	);
}

export async function inspectProviderWebhook(
	profile: ProviderProfile,
	context: ProviderInspectionContext,
	maxAgeHours = profile.webhook_max_age_hours,
): Promise<ProviderWebhookSnapshot> {
	if (!context.client) {
		throw new TypeError("Listmonk client is required for webhook inspection");
	}
	const now = context.now?.() ?? new Date();
	const settings = await readListmonkSettings(context);
	const source = profileWebhookSource(profile);
	const bounceResult = await context.client.bounce.list({
		source,
		per_page: 1,
		order_by: "created_at",
		order: "desc",
	});
	const latest = bounceItems(bounceResult)[0];
	const createdAt =
		typeof latest?.created_at === "string" ? latest.created_at : undefined;
	const latestType =
		typeof latest?.type === "string" ? latest.type : undefined;
	const parsed = createdAt === undefined ? Number.NaN : Date.parse(createdAt);
	const ageMs = Number.isFinite(parsed) ? now.getTime() - parsed : undefined;
	const freshness =
		ageMs === undefined
			? "unknown"
			: ageMs <= maxAgeHours * 3_600_000
				? "fresh"
				: "stale";
	const bounceProcessing = settingBoolean(settings, "bounce.enabled");
	const bounceWebhooks = settingBoolean(settings, "bounce.webhooks_enabled");
	const providerEnabled =
		profile.kind === "ses"
			? settingBoolean(settings, "bounce.ses_enabled")
			: undefined;
	const checks: DoctorCheck[] = [
		{
			id: "webhook.configuration",
			status:
				bounceProcessing &&
				bounceWebhooks &&
				(providerEnabled === undefined || providerEnabled)
					? "pass"
					: "fail",
			message:
				bounceProcessing &&
				bounceWebhooks &&
				(providerEnabled === undefined || providerEnabled)
					? "Listmonk provider webhook processing is enabled."
					: "Listmonk provider webhook processing is incomplete.",
		},
		{
			id: "webhook.freshness",
			status:
				freshness === "fresh"
					? "pass"
					: freshness === "stale"
						? "warn"
						: "unknown",
			message:
				freshness === "fresh"
					? "A recent provider event reached Listmonk."
					: freshness === "stale"
						? `The latest provider event is older than ${maxAgeHours} hours.`
						: "No provider event is available; use an SES simulator address to verify the webhook path.",
		},
	];
	return {
		provider_id: profile.id,
		source,
		checked_at: now.toISOString(),
		max_age_hours: maxAgeHours,
		bounce_processing_enabled: bounceProcessing,
		bounce_webhooks_enabled: bounceWebhooks,
		...(providerEnabled === undefined
			? {}
			: { provider_bounce_enabled: providerEnabled }),
		...(createdAt === undefined ? {} : { last_event_at: createdAt }),
		...(latestType === undefined ? {} : { last_event_type: latestType }),
		freshness,
		healthy: checks.every(({ status }) => status !== "fail"),
		checks,
	};
}

function isMissingDnsError(error: unknown): boolean {
	if (typeof error !== "object" || error === null || !("code" in error)) {
		return false;
	}
	const code = (error as { code?: unknown }).code;
	return code === "ENODATA" || code === "ENOTFOUND" || code === "NXDOMAIN";
}

async function withDnsTimeout<T>(
	label: string,
	timeoutMs: number,
	work: Promise<T>,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() =>
				reject(new Error(`${label} DNS lookup timed out after ${timeoutMs}ms`)),
			timeoutMs,
		);
	});
	try {
		return await Promise.race([work, timeout]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

export function createNodeDnsResolver(
	timeoutMs = DEFAULT_DNS_TIMEOUT_MS,
): ProviderDnsResolver {
	if (
		!Number.isInteger(timeoutMs) ||
		timeoutMs < 500 ||
		timeoutMs > 60_000
	) {
		throw new RangeError("DNS timeout must be between 500 and 60000ms");
	}
	return {
		async txt(name) {
			try {
				const records = await withDnsTimeout(
					name,
					timeoutMs,
					resolveTxt(name),
				);
				return records.map((chunks) => chunks.join(""));
			} catch (error) {
				if (isMissingDnsError(error)) return [];
				throw error;
			}
		},
		async cname(name) {
			try {
				return await withDnsTimeout(name, timeoutMs, resolveCname(name));
			} catch (error) {
				if (isMissingDnsError(error)) return [];
				throw error;
			}
		},
		async mx(name) {
			try {
				return await withDnsTimeout(name, timeoutMs, resolveMx(name));
			} catch (error) {
				if (isMissingDnsError(error)) return [];
				throw error;
			}
		},
	};
}

async function observeDns(
	observations: DnsObservation[],
	name: string,
	type: DnsObservation["type"],
	load: () => Promise<string[]>,
): Promise<string[]> {
	const result = await resolveDnsObservation(name, type, load);
	observations.push(result.observation);
	return result.values;
}

async function resolveDnsObservation(
	name: string,
	type: DnsObservation["type"],
	load: () => Promise<string[]>,
): Promise<{ observation: DnsObservation; values: string[] }> {
	try {
		const values = await load();
		return { observation: { name, type, values }, values };
	} catch (error) {
		return {
			observation: {
				name,
				type,
				values: [],
				error: errorMessage(error),
			},
			values: [],
		};
	}
}

export async function inspectProviderDns(
	profile: ProviderProfile,
	context: ProviderInspectionContext,
	identity?: SesIdentitySnapshot,
): Promise<ProviderDnsSnapshot> {
	const now = context.now?.() ?? new Date();
	const dns = context.dns ?? createNodeDnsResolver();
	const observations: DnsObservation[] = [];
	const checks: DoctorCheck[] = [];
	const effectiveFromDomain = fromDomain(
		profile.from_email,
		profile.sending_domain,
	);
	const dmarcName = `_dmarc.${effectiveFromDomain}`;
	const dmarc = await observeDns(observations, dmarcName, "TXT", () =>
		dns.txt(dmarcName),
	);
	const dmarcRecords = dmarc.filter((record) =>
		record.trim().toLowerCase().startsWith("v=dmarc1"),
	);
	checks.push({
		id: "dns.dmarc",
		status: dmarcRecords.length === 1 ? "pass" : "fail",
		message:
			dmarcRecords.length === 1
				? "Exactly one DMARC policy record is published."
				: `Expected exactly one DMARC policy record, found ${dmarcRecords.length}.`,
		details: { name: dmarcName },
	});

	const selectors = identity?.dkim_tokens.length
		? identity.dkim_tokens
		: profile.dkim_selectors;
	if (selectors.length === 0) {
		checks.push({
			id: "dns.dkim",
			status: "unknown",
			message:
				"No DKIM selectors are available in the provider profile or identity response.",
		});
	} else {
		const results = await Promise.all(
			selectors.map(async (selector) => {
				const name = `${selector}._domainkey.${profile.sending_domain}`;
				const result = await resolveDnsObservation(name, "CNAME", () =>
					dns.cname(name),
				);
				return {
					...result,
					ready: result.values.some((record) =>
						profile.kind === "ses"
							? record.toLowerCase().replace(/\.$/, "").endsWith(
									".dkim.amazonses.com",
								)
							: record.length > 0,
					),
				};
			}),
		);
		for (const result of results) {
			observations.push(result.observation);
		}
		const ready = results.filter((result) => result.ready).length;
		checks.push({
			id: "dns.dkim",
			status: ready === selectors.length ? "pass" : "fail",
			message:
				ready === selectors.length
					? `All ${selectors.length} DKIM records resolve.`
					: `${ready} of ${selectors.length} DKIM records resolve as expected.`,
		});
	}

	const mailFromDomain =
		identity?.mail_from_domain ?? profile.mail_from_domain;
	if (mailFromDomain === undefined) {
		checks.push({
			id: "dns.mail-from",
			status: "warn",
			message:
				"No custom MAIL FROM domain is configured; DMARC must rely on aligned DKIM.",
		});
	} else {
		const txt = await observeDns(observations, mailFromDomain, "TXT", () =>
			dns.txt(mailFromDomain),
		);
		const mxRecords = await observeDns(
			observations,
			mailFromDomain,
			"MX",
			async () =>
				(await dns.mx(mailFromDomain)).map(
					({ priority, exchange }) =>
						`${priority} ${exchange.toLowerCase().replace(/\.$/, "")}`,
				),
		);
		const spfRecords = txt.filter((record) =>
			record.trim().toLowerCase().startsWith("v=spf1"),
		);
		const expectedInclude =
			profile.expected_spf_include ??
			(profile.kind === "ses" ? "amazonses.com" : undefined);
		const spfReady =
			spfRecords.length === 1 &&
			(expectedInclude === undefined ||
				spfRecords[0]!.toLowerCase().includes(
					`include:${expectedInclude.toLowerCase()}`,
				));
		checks.push({
			id: "dns.spf",
			status: spfReady ? "pass" : "fail",
			message: spfReady
				? "Custom MAIL FROM SPF record is present."
				: "Custom MAIL FROM SPF record is missing, duplicated, or lacks the expected include.",
			details: {
				name: mailFromDomain,
				expected_include: expectedInclude,
			},
		});
		const expectedMx =
			profile.kind === "ses" && profile.region
				? `feedback-smtp.${profile.region}.amazonses.com`
				: undefined;
		const mxReady =
			mxRecords.length === 1 &&
			(expectedMx === undefined ||
				mxRecords[0]!.endsWith(` ${expectedMx}`));
		checks.push({
			id: "dns.mail-from-mx",
			status: mxReady ? "pass" : "fail",
			message: mxReady
				? "Custom MAIL FROM MX record is present."
				: "Custom MAIL FROM requires exactly one expected MX record.",
			details: { name: mailFromDomain, expected_exchange: expectedMx },
		});
		checks.push({
			id: "dns.spf-alignment",
			status: aligned(effectiveFromDomain, mailFromDomain) ? "pass" : "fail",
			message: aligned(effectiveFromDomain, mailFromDomain)
				? "MAIL FROM and From domains are aligned."
				: "MAIL FROM and From domains are not aligned.",
			details: {
				from_domain: effectiveFromDomain,
				mail_from_domain: mailFromDomain,
			},
		});
	}

	return {
		provider_id: profile.id,
		sending_domain: profile.sending_domain,
		from_domain: effectiveFromDomain,
		...(mailFromDomain === undefined
			? {}
			: { mail_from_domain: mailFromDomain }),
		checked_at: now.toISOString(),
		observations,
		checks,
		healthy: checks.every(({ status }) => status !== "fail"),
	};
}

export async function runProviderDoctor(
	profile: ProviderProfile,
	context: ProviderInspectionContext,
	maxWebhookAgeHours = profile.webhook_max_age_hours,
): Promise<ProviderDoctorSnapshot> {
	const now = context.now?.() ?? new Date();
	const snapshotContext: ProviderInspectionContext = {
		...context,
		now: () => now,
	};
	const status = await inspectProviderStatus(profile, snapshotContext);
	const [quotaResult, webhookResult] = await Promise.allSettled([
		inspectProviderQuota(profile, snapshotContext),
		inspectProviderWebhook(profile, snapshotContext, maxWebhookAgeHours),
	]);
	const quota: ProviderQuotaSnapshot =
		quotaResult.status === "fulfilled"
			? quotaResult.value
			: {
					provider_id: profile.id,
					supported: profile.kind === "ses",
					checked_at: now.toISOString(),
				};
	const webhook: ProviderWebhookSnapshot =
		webhookResult.status === "fulfilled"
			? webhookResult.value
			: {
					provider_id: profile.id,
					source: profileWebhookSource(profile),
					checked_at: now.toISOString(),
					max_age_hours: maxWebhookAgeHours,
					bounce_processing_enabled: false,
					bounce_webhooks_enabled: false,
					freshness: "unknown",
					healthy: false,
					checks: [
						{
							id: "webhook.inspection",
							status: "fail",
							message: `Failed to inspect provider webhook: ${errorMessage(webhookResult.reason)}`,
						},
					],
				};
	let identity = status.identity;
	if (identity === undefined && snapshotContext.inspector !== undefined) {
		try {
			identity = await snapshotContext.inspector.inspectIdentity();
		} catch {
			// The provider status check already reports the sanitized API failure.
		}
	}
	const dns = await inspectProviderDns(profile, snapshotContext, identity);
	const checks = [
		...status.checks,
		...webhook.checks,
		...dns.checks,
		...(quotaResult.status === "rejected"
			? [
					{
						id: "provider.quota",
						status: "fail" as const,
						message: providerApiFailureMessage(
							profile,
							quotaResult.reason,
						),
					},
				]
			: []),
	];
	const summary = {
		pass: checks.filter(({ status }) => status === "pass").length,
		warn: checks.filter(({ status }) => status === "warn").length,
		fail: checks.filter(({ status }) => status === "fail").length,
		unknown: checks.filter(({ status }) => status === "unknown").length,
	};
	return {
		provider_id: profile.id,
		checked_at: now.toISOString(),
		ready: summary.fail === 0,
		summary,
		status,
		quota,
		webhook,
		dns,
		checks,
	};
}
