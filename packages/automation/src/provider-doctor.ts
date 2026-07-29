import type { ListmonkClient } from "@listmonk-ops/openapi";
import { resolveCname, resolveMx, resolveTxt } from "node:dns/promises";
import type {
	ProviderInspector,
	ProviderProfile,
	SesAccountSnapshot,
	SesIdentitySnapshot,
} from "./provider-profiles";
import { z } from "zod";

const DEFAULT_DNS_TIMEOUT_MS = 5_000;
const DEFAULT_DNS_INSPECTION_TIMEOUT_MS = 10_000;
const MAX_DMARC_TREE_WALK_QUERIES = 8;
const REQUIRED_READINESS_CHECK_IDS = new Set([
	"listmonk.from-alignment",
	"dns.dmarc",
	"dns.dkim",
	"dns.dkim-alignment",
	"dns.spf",
	"dns.mail-from-mx",
	"dns.spf-alignment",
]);

function hasReadinessBlocker(checks: readonly DoctorCheck[]): boolean {
	return checks.some(
		({ id, status }) =>
			status === "fail" ||
			(status === "unknown" && REQUIRED_READINESS_CHECK_IDS.has(id)),
	);
}

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
	messenger_binding_ambiguous: boolean;
	messenger_configured: boolean;
	messenger_enabled: boolean;
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
	evidence_scope: "profile" | "shared";
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
	profiles?: readonly ProviderProfile[] | undefined;
	dns?: ProviderDnsResolver | undefined;
	dnsInspectionTimeoutMs?: number | undefined;
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

function hasProviderResponse(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	if ("$response" in error && error.$response !== undefined) return true;
	if (!("$metadata" in error)) return false;
	const metadata = error.$metadata;
	return (
		typeof metadata === "object" &&
		metadata !== null &&
		"httpStatusCode" in metadata &&
		typeof metadata.httpStatusCode === "number"
	);
}

function providerApiFailureMessage(
	profile: ProviderProfile,
	error: unknown,
): string {
	return `${profile.kind.toUpperCase()} provider inspection failed (${errorCode(error)}). Check the configured credential reference and provider permissions.`;
}

function fromDomain(fromEmail: string | undefined): string | undefined {
	if (!fromEmail) return undefined;
	const value = fromEmail.trim();
	let mailbox = value;
	if (value.includes("<") || value.includes(">")) {
		// Accept a plain mailbox, Name <mailbox>, "Quoted Name" <mailbox>,
		// and the bare <mailbox> form emitted by some mail configuration UIs.
		const displayMailbox =
			/^(?:"[^"\r\n]*"|[^<>\r\n]*)?\s*<([^<>\r\n]+)>$/.exec(value);
		if (!displayMailbox) return undefined;
		mailbox = displayMailbox[1]!.trim();
	}
	const parsed = z.email().safeParse(mailbox);
	if (!parsed.success) return undefined;
	return parsed.data.slice(parsed.data.lastIndexOf("@") + 1).toLowerCase();
}

function validatedDomain(domain: string | undefined): string | undefined {
	if (!domain) return undefined;
	const normalized = normalizeDomain(domain.trim());
	if (!normalized) return undefined;
	return z.email().safeParse(`probe@${normalized}`).success
		? normalized
		: undefined;
}

function normalizeDomain(domain: string): string {
	return domain.toLowerCase().replace(/\.$/, "");
}

function isSameOrSubdomain(domain: string, parentDomain: string): boolean {
	const normalizedDomain = normalizeDomain(domain);
	const normalizedParent = normalizeDomain(parentDomain);
	return (
		normalizedDomain === normalizedParent ||
		normalizedDomain.endsWith(`.${normalizedParent}`)
	);
}

function normalizeMessengerName(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function recordName(
	record: Readonly<Record<string, unknown>>,
): string | undefined {
	return typeof record.name === "string"
		? normalizeMessengerName(record.name)
		: undefined;
}

function isRecordEnabled(record: Readonly<Record<string, unknown>>): boolean {
	// Listmonk serializes this setting as a boolean. Treat missing or malformed
	// values as disabled so readiness remains fail-closed.
	return record.enabled === true;
}

function messengerRecords(
	settings: Readonly<Record<string, unknown>>,
): ReadonlyArray<Readonly<Record<string, unknown>>> {
	const value = settings.messengers;
	if (!Array.isArray(value)) return [];
	return value.filter(
		(entry): entry is Readonly<Record<string, unknown>> =>
			typeof entry === "object" && entry !== null,
	);
}

function profileWebhookSource(profile: ProviderProfile): string {
	return profile.webhook_source ?? profile.kind;
}

function sharedWebhookProfileIds(
	profile: ProviderProfile,
	profiles: readonly ProviderProfile[] = [profile],
): string[] {
	const source = profileWebhookSource(profile);
	return profiles
		.filter(
			(candidate) =>
				candidate.id !== profile.id &&
				profileWebhookSource(candidate) === source,
		)
		.map(({ id }) => id);
}

function webhookEvidenceScope(
	profile: ProviderProfile,
	profiles?: readonly ProviderProfile[] | undefined,
): ProviderWebhookSnapshot["evidence_scope"] {
	return sharedWebhookProfileIds(profile, profiles).length > 0
		? "shared"
		: "profile";
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

function hasAmbiguousMessengerBinding(
	profile: ProviderProfile,
	profiles: readonly ProviderProfile[],
): boolean {
	const expectedHosts = new Set(expectedSmtpHosts(profile));
	const messenger = normalizeMessengerName(profile.messenger);
	return profiles.some(
		(candidate) =>
			candidate.id !== profile.id &&
			normalizeMessengerName(candidate.messenger) === messenger &&
			expectedSmtpHosts(candidate).some((host) => expectedHosts.has(host)),
	);
}

export function inspectListmonkProviderSettings(
	profile: ProviderProfile,
	settings: Readonly<Record<string, unknown>>,
	profiles: readonly ProviderProfile[] = [profile],
): ProviderListmonkSnapshot {
	const expectedHosts = expectedSmtpHosts(profile);
	const smtp = smtpRecords(settings);
	const matching = smtp.filter((record) => {
		const host = smtpHost(record);
		return host !== undefined && expectedHosts.includes(host);
	});
	const messengerName = normalizeMessengerName(profile.messenger);
	const namedSmtp = matching.filter(
		(record) => recordName(record) === messengerName,
	);
	const namedCustomMessenger = messengerRecords(settings).filter(
		(record) => recordName(record) === messengerName,
	);
	const matchingMessengers =
		messengerName === "email"
			? matching
			: [...namedSmtp, ...namedCustomMessenger];
	const messengerBindingAmbiguous = hasAmbiguousMessengerBinding(
		profile,
		profiles,
	);
	const configuredFrom =
		typeof settings["app.from_email"] === "string"
			? settings["app.from_email"]
			: undefined;
	const configuredFromDomain = fromDomain(configuredFrom);

	return {
		...(configuredFrom === undefined ? {} : { from_email: configuredFrom }),
		...(configuredFromDomain === undefined
			? {}
			: { from_domain: configuredFromDomain }),
		messenger: profile.messenger,
		messenger_binding_ambiguous: messengerBindingAmbiguous,
		messenger_configured:
			!messengerBindingAmbiguous && matchingMessengers.length > 0,
		messenger_enabled:
			!messengerBindingAmbiguous &&
			matchingMessengers.some(isRecordEnabled),
		smtp_hosts: smtp
			.map(smtpHost)
			.filter((host): host is string => host !== undefined),
		matching_smtp_hosts: matching
			.map(smtpHost)
			.filter((host): host is string => host !== undefined),
		smtp_configured: matching.length > 0,
		smtp_enabled: matching.some(isRecordEnabled),
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
	throwOnListmonkResponseError(result, "Listmonk settings inspection");
	return result.data as Readonly<Record<string, unknown>>;
}

function settingsChecks(
	profile: ProviderProfile,
	snapshot: ProviderListmonkSnapshot,
): DoctorCheck[] {
	let fromAlignmentStatus: DoctorCheckStatus;
	let fromAlignmentMessage: string;
	if (snapshot.from_domain === undefined) {
		fromAlignmentStatus =
			snapshot.from_email === undefined ? "unknown" : "fail";
		fromAlignmentMessage =
			snapshot.from_email === undefined
				? "Listmonk did not return an app.from_email setting."
				: "Listmonk app.from_email is not a valid email address.";
	} else if (
		isSameOrSubdomain(snapshot.from_domain, profile.sending_domain)
	) {
		fromAlignmentStatus = "pass";
		fromAlignmentMessage =
			"Listmonk From domain aligns with the provider sending domain.";
	} else {
		fromAlignmentStatus = "fail";
		fromAlignmentMessage =
			"Listmonk From domain does not align with the provider sending domain.";
	}
	let messengerStatus: DoctorCheckStatus;
	let messengerMessage: string;
	if (snapshot.messenger_binding_ambiguous) {
		messengerStatus = "fail";
		messengerMessage = `Listmonk messenger '${snapshot.messenger}' is shared by provider profiles with the same SMTP endpoint; use distinct messenger names.`;
	} else if (
		snapshot.messenger_configured &&
		snapshot.messenger_enabled
	) {
		messengerStatus = "pass";
		messengerMessage = `Listmonk messenger '${snapshot.messenger}' is configured and enabled.`;
	} else {
		messengerStatus = "fail";
		messengerMessage = `Listmonk messenger '${snapshot.messenger}' is missing or disabled.`;
	}

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
			id: "listmonk.messenger",
			status: messengerStatus,
			message: messengerMessage,
		},
		{
			id: "listmonk.from-alignment",
			status: fromAlignmentStatus,
			message: fromAlignmentMessage,
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
			status: account.production_access_enabled === true ? "pass" : "fail",
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
	let accountError: unknown;
	let identityError: unknown;
	let api: ProviderApiProbe;

	if (profile.kind !== "ses" || context.inspector === undefined) {
		api = {
			supported: false,
			reachable: false,
			authenticated: false,
		};
	} else {
		const [accountResult, identityResult] = await Promise.allSettled([
			context.inspector.inspectAccount(),
			context.inspector.inspectIdentity(),
		]);
		if (accountResult.status === "fulfilled") {
			account = accountResult.value;
		} else {
			accountError = accountResult.reason;
		}
		if (identityResult.status === "fulfilled") {
			identity = identityResult.value;
		} else {
			identityError = identityResult.reason;
		}
		const firstError = accountError ?? identityError;
		const hasSuccessfulRequest =
			account !== undefined || identity !== undefined;
		const hasAnyError =
			accountError !== undefined || identityError !== undefined;
		const hasProviderErrorResponse = [accountError, identityError].some(
			hasProviderResponse,
		);
		api = {
			supported: true,
			reachable: hasSuccessfulRequest || hasProviderErrorResponse,
			authenticated: hasSuccessfulRequest && !hasAnyError,
			latency_ms: Math.max(0, Date.now() - startedAt),
			...(firstError === undefined
				? {}
				: {
						error_code: errorCode(firstError),
						error_message: providerApiFailureMessage(profile, firstError),
					}),
		};
	}

	let listmonk: ProviderListmonkSnapshot | undefined;
	const checks: DoctorCheck[] = [];
	try {
		listmonk = inspectListmonkProviderSettings(
			profile,
			await readListmonkSettings(context),
			context.profiles ?? [profile],
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
	if (accountError !== undefined) {
		checks.push({
			id: "provider.account",
			status: "fail",
			message: providerApiFailureMessage(profile, accountError),
		});
	}
	if (identityError !== undefined) {
		checks.push({
			id: "provider.identity",
			status: "fail",
			message: providerApiFailureMessage(profile, identityError),
		});
	}
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
			reachable: hasProviderResponse(error),
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
	let account: SesAccountSnapshot;
	try {
		account = await context.inspector.inspectAccount();
	} catch (error) {
		throw new Error(providerApiFailureMessage(profile, error));
	}
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

function bounceItems(
	result: unknown,
): ReadonlyArray<Readonly<Record<string, unknown>>> {
	if (typeof result !== "object" || result === null) {
		throw new TypeError(
			"Listmonk bounce inspection returned an invalid payload",
		);
	}
	const data = (result as { data?: unknown }).data;
	if (typeof data !== "object" || data === null) {
		throw new TypeError(
			"Listmonk bounce inspection returned an invalid payload",
		);
	}
	const results = (data as { results?: unknown }).results;
	if (!Array.isArray(results)) {
		throw new TypeError(
			"Listmonk bounce inspection returned an invalid payload",
		);
	}
	if (
		results.some((item) => typeof item !== "object" || item === null)
	) {
		throw new TypeError(
			"Listmonk bounce inspection returned an invalid payload",
		);
	}
	return results as ReadonlyArray<Readonly<Record<string, unknown>>>;
}

function throwOnListmonkResponseError(
	result: unknown,
	operation: string,
): void {
	if (
		typeof result === "object" &&
		result !== null &&
		"error" in result &&
		(result as { error?: unknown }).error !== undefined
	) {
		throw new Error(
			`${operation} failed. Verify Listmonk credentials and API availability.`,
		);
	}
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
	throwOnListmonkResponseError(bounceResult, "Listmonk bounce inspection");
	const sharedProfileIds = sharedWebhookProfileIds(profile, context.profiles);
	const evidenceScope = webhookEvidenceScope(profile, context.profiles);
	const sharedEvidence = evidenceScope === "shared";
	const items = bounceItems(bounceResult);
	const latest = sharedEvidence ? undefined : items[0];
	const createdAt =
		typeof latest?.created_at === "string" ? latest.created_at : undefined;
	const latestType =
		typeof latest?.type === "string" ? latest.type : undefined;
	const parsed = createdAt === undefined ? Number.NaN : Date.parse(createdAt);
	const normalizedCreatedAt = Number.isFinite(parsed)
		? new Date(parsed).toISOString()
		: undefined;
	const ageMs = Number.isFinite(parsed) ? now.getTime() - parsed : undefined;
	const futureTimestamp = ageMs !== undefined && ageMs < 0;
	const freshness =
		sharedEvidence || ageMs === undefined || futureTimestamp
			? "unknown"
			: ageMs <= maxAgeHours * 3_600_000
				? "fresh"
				: "stale";
	let freshnessStatus: DoctorCheckStatus;
	let freshnessMessage: string;
	if (freshness === "fresh") {
		freshnessStatus = "pass";
		freshnessMessage = "A recent provider event reached Listmonk.";
	} else if (freshness === "stale") {
		freshnessStatus = "warn";
		freshnessMessage = `The latest provider event is older than ${maxAgeHours} hours.`;
	} else if (futureTimestamp) {
		freshnessStatus = "unknown";
		freshnessMessage =
			"The latest provider event has a future timestamp; verify system clocks before treating it as freshness evidence.";
	} else if (sharedEvidence) {
		freshnessStatus = "unknown";
		freshnessMessage =
			"Webhook evidence uses a source shared by multiple provider profiles and cannot be attributed to this profile.";
	} else {
		freshnessStatus = "unknown";
		freshnessMessage =
			"No provider event is available; use an SES simulator address to verify the webhook path.";
	}
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
			status: freshnessStatus,
			message: freshnessMessage,
			...(sharedEvidence
				? { details: { shared_provider_ids: sharedProfileIds } }
				: {}),
		},
	];
	return {
		provider_id: profile.id,
		source,
		evidence_scope: evidenceScope,
		checked_at: now.toISOString(),
		max_age_hours: maxAgeHours,
		bounce_processing_enabled: bounceProcessing,
		bounce_webhooks_enabled: bounceWebhooks,
		...(providerEnabled === undefined
			? {}
			: { provider_bounce_enabled: providerEnabled }),
		...(normalizedCreatedAt === undefined
			? {}
			: { last_event_at: normalizedCreatedAt }),
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

class DnsTimeoutError extends Error {
	override readonly name = "DnsTimeoutError";
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
				reject(
					new DnsTimeoutError(
						`${label} DNS lookup timed out after ${timeoutMs}ms`,
					),
				),
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

async function resolveDnsObservation(
	name: string,
	type: DnsObservation["type"],
	load: () => Promise<string[]>,
): Promise<{
	observation: DnsObservation;
	values: string[];
	outcome: "found" | "missing" | "error";
}> {
	try {
		const values = await load();
		return {
			observation: { name, type, values },
			values,
			outcome: values.length > 0 ? "found" : "missing",
		};
	} catch (error) {
		return {
			observation: {
				name,
				type,
				values: [],
				error: errorMessage(error),
			},
			values: [],
			outcome: "error",
		};
	}
}

interface DmarcPolicyRecord {
	domain: string;
	name: string;
	value: string;
	tags: ReadonlyMap<string, string>;
}

interface DmarcDiscovery {
	organizationalDomain: string;
	policy?: DmarcPolicyRecord | undefined;
	observations: DnsObservation[];
	indeterminate: boolean;
	organizationalDomainIndeterminate: boolean;
	duplicateDomains: string[];
}

function dmarcTreeWalkDomains(domain: string): string[] {
	const labels = normalizeDomain(domain).split(".");
	if (labels.length <= MAX_DMARC_TREE_WALK_QUERIES) {
		return labels.map((_, index) => labels.slice(index).join("."));
	}
	// RFC 9989 section 4.10 always queries the full domain first, then skips
	// directly to seven labels before continuing towards the root.
	const suffixStart = labels.length - (MAX_DMARC_TREE_WALK_QUERIES - 1);
	return [
		labels.join("."),
		...labels.slice(suffixStart).map((_, index) =>
			labels.slice(suffixStart + index).join("."),
		),
	];
}

function parseTagRecord(
	record: string,
	options: { lowercaseValues?: boolean } = {},
): ReadonlyMap<string, string> | undefined {
	const tags = new Map<string, string>();
	for (const item of record.split(";")) {
		const separator = item.indexOf("=");
		if (separator < 1) continue;
		const key = item.slice(0, separator).trim().toLowerCase();
		const rawValue = item.slice(separator + 1).trim();
		const value = options.lowercaseValues ? rawValue.toLowerCase() : rawValue;
		if (!key) continue;
		if (tags.has(key)) return undefined;
		tags.set(key, value);
	}
	return tags;
}

function parseDmarcTags(
	record: string,
): ReadonlyMap<string, string> | undefined {
	return parseTagRecord(record, { lowercaseValues: true });
}

const DMARC_POLICIES = new Set(["none", "quarantine", "reject"]);

function validDmarcPolicyRecord(
	record: string,
): { value: string; tags: ReadonlyMap<string, string> } | undefined {
	if (!isDmarcCandidateRecord(record)) return undefined;
	const tags = parseDmarcTags(record);
	if (tags === undefined) return undefined;
	if (tags.get("v") !== "dmarc1") return undefined;
	const policy = tags.get("p");
	if (policy === undefined || !DMARC_POLICIES.has(policy)) return undefined;
	for (const key of ["sp", "np"]) {
		const value = tags.get(key);
		if (value !== undefined && !DMARC_POLICIES.has(value)) return undefined;
	}
	for (const key of ["adkim", "aspf"]) {
		const value = tags.get(key);
		if (value !== undefined && value !== "r" && value !== "s") return undefined;
	}
	const psd = tags.get("psd");
	if (
		psd !== undefined &&
		psd !== "y" &&
		psd !== "n" &&
		psd !== "u"
	) {
		return undefined;
	}
	return { value: record, tags };
}

function isDmarcCandidateRecord(record: string): boolean {
	return /^\s*v\s*=\s*dmarc1\s*(?:;|$)/i.test(record);
}

function childDomainBelow(startingDomain: string, parentDomain: string): string {
	const startingLabels = normalizeDomain(startingDomain).split(".");
	const parentLabels = normalizeDomain(parentDomain).split(".");
	if (startingLabels.length <= parentLabels.length) return startingDomain;
	return startingLabels.slice(startingLabels.length - parentLabels.length - 1).join(
		".",
	);
}

async function discoverDmarcPolicy(
	domain: string,
	dns: ProviderDnsResolver,
): Promise<DmarcDiscovery> {
	const startingDomain = normalizeDomain(domain);
	const records: DmarcPolicyRecord[] = [];
	const observations: DnsObservation[] = [];
	const allDuplicateDomains: string[] = [];
	const candidates = dmarcTreeWalkDomains(startingDomain);
	const results = await Promise.all(
		candidates.map(async (candidate) => {
		const name = `_dmarc.${candidate}`;
		const result = await resolveDnsObservation(name, "TXT", () =>
			dns.txt(name),
		);
			return { candidate, name, result };
		}),
	);

	for (const { candidate, name, result } of results) {
		observations.push(result.observation);
		const candidateRecords = result.values.filter(isDmarcCandidateRecord);
		if (candidateRecords.length > 1) {
			allDuplicateDomains.push(candidate);
			continue;
		}
		const policyRecord =
			candidateRecords[0] === undefined
				? undefined
				: validDmarcPolicyRecord(candidateRecords[0]);
		if (policyRecord !== undefined) {
			records.push({
				domain: candidate,
				name,
				value: policyRecord.value,
				tags: policyRecord.tags,
			});
		}
	}

	let organizationalDomain: string | undefined;
	let organizationalEvidenceIndex: number | undefined;
	for (const record of records) {
		// RFC 9989 defaults an omitted `psd` tag to `u`; only an explicit
		// `n` or `y` terminates organizational-domain discovery early.
		const psd = record.tags.get("psd") ?? "u";
		if (psd === "n") {
			organizationalDomain = record.domain;
			organizationalEvidenceIndex = candidates.indexOf(record.domain);
			break;
		}
		if (
			record.domain !== startingDomain &&
			psd === "y"
		) {
			organizationalDomain = childDomainBelow(startingDomain, record.domain);
			organizationalEvidenceIndex = candidates.indexOf(record.domain);
			break;
		}
	}
	organizationalDomain ??= records.at(-1)?.domain ?? startingDomain;

	const discoveryEndIndex =
		organizationalEvidenceIndex ?? candidates.length - 1;
	const relevantRecords = records.filter(
		({ domain: recordDomain }) =>
			candidates.indexOf(recordDomain) <= discoveryEndIndex,
	);
	const policy =
		relevantRecords.find(
			({ domain: recordDomain }) => recordDomain === startingDomain,
		) ??
		relevantRecords.find(
			({ domain: recordDomain }) => recordDomain === organizationalDomain,
		) ??
		relevantRecords.at(-1);
	const policyIndex =
		policy === undefined
			? candidates.length
			: candidates.indexOf(policy.domain);
	const relevantCandidates = new Set(
		candidates.slice(0, Math.max(0, policyIndex) + 1),
	);
	const duplicateDomains = allDuplicateDomains.filter((candidate) =>
		relevantCandidates.has(candidate),
	);
	const indeterminate = results
		.slice(0, policy === undefined ? results.length : Math.max(0, policyIndex))
		.some(({ result }) => result.outcome === "error");
	const organizationalDomainIndeterminate = results
		.slice(
			0,
			organizationalEvidenceIndex === undefined
				? results.length
				: Math.max(0, organizationalEvidenceIndex),
		)
		.some(({ result }) => result.outcome === "error");
	return {
		organizationalDomain,
		...(policy === undefined ? {} : { policy }),
		observations,
		indeterminate,
		organizationalDomainIndeterminate,
		duplicateDomains,
	};
}

function hasDirectDkimKey(record: string): boolean {
	const tags = parseTagRecord(record);
	const version = tags?.get("v")?.toLowerCase();
	return (
		tags !== undefined &&
		(version === undefined || version === "dkim1") &&
		(tags.get("p")?.length ?? 0) > 0
	);
}

function hasSingleDirectDkimKey(records: readonly string[]): boolean {
	return records.length === 1 && hasDirectDkimKey(records[0]!);
}

function hasExactSpfInclude(record: string, expectedDomain: string): boolean {
	const expected = normalizeDomain(expectedDomain);
	for (const mechanism of record.trim().split(/\s+/).slice(1)) {
		const qualifier = /^[+?~-]/.exec(mechanism)?.[0];
		const unqualified = mechanism.replace(/^[+?~-]/, "");
		if (unqualified.toLowerCase() === "all") return false;
		if (qualifier !== undefined && qualifier !== "+") continue;
		if (!unqualified.toLowerCase().startsWith("include:")) continue;
		if (
			normalizeDomain(unqualified.slice("include:".length)) === expected
		) {
			return true;
		}
	}
	return false;
}

async function inspectProviderDnsUnbounded(
	profile: ProviderProfile,
	context: ProviderInspectionContext,
	identity?: SesIdentitySnapshot,
	fromDomainOverride?: string,
): Promise<ProviderDnsSnapshot> {
	const now = context.now?.() ?? new Date();
	const dns = context.dns ?? createNodeDnsResolver();
	const observations: DnsObservation[] = [];
	const checks: DoctorCheck[] = [];
	const effectiveFromDomain =
		validatedDomain(fromDomainOverride) ??
		fromDomain(profile.from_email) ??
		profile.sending_domain;
	const dmarc = await discoverDmarcPolicy(effectiveFromDomain, dns);
	observations.push(...dmarc.observations);
	const dmarcStatus: DoctorCheckStatus =
		dmarc.duplicateDomains.length > 0
			? "fail"
			: dmarc.indeterminate
				? "unknown"
				: dmarc.policy !== undefined
					? "pass"
					: "fail";
	let dmarcMessage: string;
	if (dmarc.duplicateDomains.length > 0) {
		dmarcMessage = `Multiple DMARC records are published for ${dmarc.duplicateDomains.join(", ")}.`;
	} else if (dmarc.indeterminate) {
		dmarcMessage =
			"DMARC policy could not be determined because a DNS lookup failed.";
	} else if (dmarc.policy === undefined) {
		dmarcMessage = "No applicable DMARC policy record is published.";
	} else if (dmarc.policy.domain === effectiveFromDomain) {
		dmarcMessage = "A DMARC policy record is published for the From domain.";
	} else {
		dmarcMessage = `The From domain inherits DMARC policy from ${dmarc.policy.domain}.`;
	}
	checks.push({
		id: "dns.dmarc",
		status: dmarcStatus,
		message: dmarcMessage,
		details: {
			name: dmarc.policy?.name ?? `_dmarc.${effectiveFromDomain}`,
			organizational_domain: dmarc.organizationalDomain,
		},
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
				const cname = await resolveDnsObservation(name, "CNAME", () =>
					dns.cname(name),
				);
				let delegatedObservations: DnsObservation[] = [];
				let delegatedReady = false;
				let delegatedIndeterminate = false;
				if (profile.kind === "ses") {
					const expectedTarget = normalizeDomain(
						`${selector}.dkim.amazonses.com`,
					);
					delegatedReady =
						cname.values.length === 1 &&
						normalizeDomain(cname.values[0]!) === expectedTarget;
				} else if (cname.values.length > 0) {
					const delegatedResults = await Promise.all(
						cname.values.map(async (target) => {
							const normalizedTarget = normalizeDomain(target);
							return resolveDnsObservation(
								normalizedTarget,
								"TXT",
								() => dns.txt(normalizedTarget),
							);
						}),
					);
					delegatedObservations = delegatedResults.map(
						({ observation }) => observation,
					);
					delegatedReady =
						delegatedResults.length === 1 &&
						hasSingleDirectDkimKey(delegatedResults[0]!.values);
					delegatedIndeterminate = delegatedResults.some(
						({ outcome }) => outcome === "error",
					);
				}
				const direct =
					cname.outcome === "missing"
						? await resolveDnsObservation(name, "TXT", () =>
								dns.txt(name),
							)
						: undefined;
				const directReady =
					direct !== undefined && hasSingleDirectDkimKey(direct.values);
				return {
					observations: [
						cname.observation,
						...delegatedObservations,
						...(direct === undefined ? [] : [direct.observation]),
					],
					ready: delegatedReady || directReady,
					indeterminate:
						!delegatedReady &&
						!directReady &&
						(cname.outcome === "error" ||
							delegatedIndeterminate ||
							direct?.outcome === "error"),
				};
			}),
		);
		for (const result of results) {
			observations.push(...result.observations);
		}
		const ready = results.filter((result) => result.ready).length;
		const indeterminate = results.filter(
			(result) => !result.ready && result.indeterminate,
		).length;
		const failed = selectors.length - ready - indeterminate;
		checks.push({
			id: "dns.dkim",
			status:
				ready === selectors.length
					? "pass"
					: failed > 0
						? "fail"
						: "unknown",
			message:
				ready === selectors.length
					? `All ${selectors.length} DKIM records resolve.`
					: failed > 0
						? `${ready} of ${selectors.length} DKIM records resolve as expected.`
						: "DKIM readiness could not be determined because a DNS lookup failed.",
		});
	}

	const dkimAlignmentMode =
		dmarc.policy?.tags.get("adkim") === "s" ? "strict" : "relaxed";
	const signingDomain = profile.sending_domain;
	let signingOrganizationalDomain: string | undefined;
	let dkimAlignmentStatus: DoctorCheckStatus;
	if (dmarc.policy === undefined || dmarc.indeterminate) {
		dkimAlignmentStatus = "unknown";
	} else if (
		normalizeDomain(signingDomain) === normalizeDomain(effectiveFromDomain)
	) {
		signingOrganizationalDomain = dmarc.organizationalDomain;
		dkimAlignmentStatus = "pass";
	} else if (dkimAlignmentMode === "strict") {
		dkimAlignmentStatus = "fail";
	} else {
		const signingDmarc = await discoverDmarcPolicy(signingDomain, dns);
		observations.push(...signingDmarc.observations);
		signingOrganizationalDomain = signingDmarc.organizationalDomain;
		if (
			dmarc.organizationalDomainIndeterminate ||
			signingDmarc.organizationalDomainIndeterminate
		) {
			dkimAlignmentStatus = "unknown";
		} else if (
			normalizeDomain(dmarc.organizationalDomain) ===
			normalizeDomain(signingDmarc.organizationalDomain)
		) {
			dkimAlignmentStatus = "pass";
		} else {
			dkimAlignmentStatus = "fail";
		}
	}
	let dkimAlignmentMessage: string;
	if (dkimAlignmentStatus === "pass") {
		dkimAlignmentMessage = `DKIM signing and From domains have ${dkimAlignmentMode} DMARC alignment.`;
	} else if (dkimAlignmentStatus === "unknown") {
		dkimAlignmentMessage =
			"DMARC DKIM alignment could not be determined from the available DNS policy.";
	} else {
		dkimAlignmentMessage = `DKIM signing and From domains do not have ${dkimAlignmentMode} DMARC alignment.`;
	}
	checks.push({
		id: "dns.dkim-alignment",
		status: dkimAlignmentStatus,
		message: dkimAlignmentMessage,
		details: {
			from_domain: effectiveFromDomain,
			signing_domain: signingDomain,
			alignment_mode: dkimAlignmentMode,
			from_organizational_domain: dmarc.organizationalDomain,
			signing_organizational_domain: signingOrganizationalDomain,
		},
	});

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
		const txt = await resolveDnsObservation(mailFromDomain, "TXT", () =>
			dns.txt(mailFromDomain),
		);
		observations.push(txt.observation);
		const mx = await resolveDnsObservation(
			mailFromDomain,
			"MX",
			async () =>
				(await dns.mx(mailFromDomain)).map(
					({ priority, exchange }) =>
						`${priority} ${exchange.toLowerCase().replace(/\.$/, "")}`,
				),
		);
		observations.push(mx.observation);
		const spfRecords = txt.values.filter((record) =>
			record.trim().toLowerCase().startsWith("v=spf1"),
		);
		const expectedInclude =
			profile.expected_spf_include ??
			(profile.kind === "ses" ? "amazonses.com" : undefined);
		const spfReady =
			spfRecords.length === 1 &&
			expectedInclude !== undefined &&
			hasExactSpfInclude(spfRecords[0]!, expectedInclude);
		const spfStatus: DoctorCheckStatus =
			txt.outcome === "error" || expectedInclude === undefined
				? "unknown"
				: spfReady
					? "pass"
					: "fail";
		const spfMessage =
			txt.outcome === "error"
				? "Custom MAIL FROM SPF could not be determined because the DNS lookup failed."
				: expectedInclude === undefined
					? "Generic SMTP SPF readiness requires expected_spf_include so authorization can be verified."
					: spfReady
						? "Custom MAIL FROM SPF record is present."
						: "Custom MAIL FROM SPF record is missing, duplicated, or lacks the expected include.";
		checks.push({
			id: "dns.spf",
			status: spfStatus,
			message: spfMessage,
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
			expectedMx === undefined
				? mx.values.length > 0
				: mx.values.length === 1 &&
					mx.values[0] === `10 ${expectedMx}`;
		const mxStatus: DoctorCheckStatus =
			mx.outcome === "error" ? "unknown" : mxReady ? "pass" : "fail";
		const mxMessage =
			mxStatus === "unknown"
				? "Custom MAIL FROM MX could not be determined because the DNS lookup failed."
				: mxReady
					? "Custom MAIL FROM MX record is present."
					: expectedMx === undefined
						? "Custom MAIL FROM requires at least one MX record."
						: "Custom MAIL FROM requires exactly one expected MX record.";
		checks.push({
			id: "dns.mail-from-mx",
			status: mxStatus,
			message: mxMessage,
			details: { name: mailFromDomain, expected_exchange: expectedMx },
		});
		const alignmentMode =
			dmarc.policy?.tags.get("aspf") === "s" ? "strict" : "relaxed";
		let alignmentStatus: DoctorCheckStatus;
		let mailFromOrganizationalDomain: string | undefined;
		if (dmarc.policy === undefined) {
			alignmentStatus = "unknown";
		} else if (alignmentMode === "strict") {
			const domainsMatch =
				normalizeDomain(effectiveFromDomain) ===
				normalizeDomain(mailFromDomain);
			alignmentStatus = domainsMatch ? "pass" : "fail";
		} else {
			const mailFromDmarc = await discoverDmarcPolicy(mailFromDomain, dns);
			observations.push(...mailFromDmarc.observations);
			mailFromOrganizationalDomain = mailFromDmarc.organizationalDomain;
			const domainsMatch =
				normalizeDomain(dmarc.organizationalDomain) ===
				normalizeDomain(mailFromDmarc.organizationalDomain);
			alignmentStatus =
				dmarc.organizationalDomainIndeterminate ||
				mailFromDmarc.organizationalDomainIndeterminate
					? "unknown"
					: domainsMatch
						? "pass"
						: "fail";
		}
		const alignmentMessage =
			alignmentStatus === "pass"
				? `MAIL FROM and From domains have ${alignmentMode} DMARC alignment.`
				: alignmentStatus === "unknown"
					? "DMARC SPF alignment could not be determined from the available DNS policy."
					: `MAIL FROM and From domains do not have ${alignmentMode} DMARC alignment.`;
		checks.push({
			id: "dns.spf-alignment",
			status: alignmentStatus,
			message: alignmentMessage,
			details: {
				from_domain: effectiveFromDomain,
				mail_from_domain: mailFromDomain,
				alignment_mode: alignmentMode,
				from_organizational_domain: dmarc.organizationalDomain,
				mail_from_organizational_domain: mailFromOrganizationalDomain,
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
		healthy: !hasReadinessBlocker(checks),
	};
}

export async function inspectProviderDns(
	profile: ProviderProfile,
	context: ProviderInspectionContext,
	identity?: SesIdentitySnapshot,
	fromDomainOverride?: string,
): Promise<ProviderDnsSnapshot> {
	const timeoutMs =
		context.dnsInspectionTimeoutMs ?? DEFAULT_DNS_INSPECTION_TIMEOUT_MS;
	if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
		throw new RangeError(
			"DNS inspection timeout must be between 1 and 60000ms",
		);
	}
	try {
		return await withDnsTimeout(
			"Provider DNS inspection",
			timeoutMs,
			inspectProviderDnsUnbounded(
				profile,
				context,
				identity,
				fromDomainOverride,
			),
		);
	} catch (error) {
		if (!(error instanceof DnsTimeoutError)) throw error;
		const now = context.now?.() ?? new Date();
		const effectiveFromDomain =
			validatedDomain(fromDomainOverride) ??
			fromDomain(profile.from_email) ??
			profile.sending_domain;
		const mailFromDomain =
			identity?.mail_from_domain ?? profile.mail_from_domain;
		const requiredCheckIds = [
			"dns.dmarc",
			"dns.dkim",
			"dns.dkim-alignment",
			...(mailFromDomain === undefined
				? []
				: ["dns.spf", "dns.mail-from-mx", "dns.spf-alignment"]),
		];
		const checks: DoctorCheck[] = requiredCheckIds.map((id) => ({
			id,
			status: "unknown",
			message:
				"Provider DNS inspection exceeded its total deadline; retry after verifying resolver availability.",
		}));
		return {
			provider_id: profile.id,
			sending_domain: profile.sending_domain,
			from_domain: effectiveFromDomain,
			...(mailFromDomain === undefined
				? {}
				: { mail_from_domain: mailFromDomain }),
			checked_at: now.toISOString(),
			observations: [],
			checks,
			healthy: false,
		};
	}
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
					evidence_scope: webhookEvidenceScope(
						profile,
						snapshotContext.profiles,
					),
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
	const dns = await inspectProviderDns(
		profile,
		snapshotContext,
		identity,
		status.listmonk?.from_domain,
	);
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
		...(quotaResult.status === "fulfilled" &&
		quota.supported &&
		quota.max_24_hour_send !== undefined &&
		quota.max_24_hour_send !== -1 &&
		quota.remaining_24_hours === 0
			? [
					{
						id: "provider.quota",
						status: "fail" as const,
						message:
							"The provider daily sending quota is exhausted; wait for capacity to recover or request a quota increase.",
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
		ready: !hasReadinessBlocker(checks),
		summary,
		status,
		quota,
		webhook,
		dns,
		checks,
	};
}
