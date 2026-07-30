import type { ListmonkClient } from "@listmonk-ops/openapi";
import { Buffer } from "node:buffer";
import { createHash, createPublicKey } from "node:crypto";
import {
	resolve4,
	resolve6,
	resolveCname,
	resolveMx,
	resolveTxt,
} from "node:dns/promises";
import { isIP } from "node:net";
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
const MAX_SPF_DNS_LOOKUPS = 10;
const MAX_SPF_VOID_LOOKUPS = 2;
const ED25519_FIELD_PRIME = (1n << 255n) - 19n;
const ED25519_CURVE_D =
	37095705934669439343138083508754565189542113879843219016388785533085940283555n;
const ED25519_SQRT_MINUS_ONE =
	19681161376707505956807079304988542015446066515923890162744021073123829784752n;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const REQUIRED_READINESS_CHECK_IDS = new Set([
	"listmonk.from-alignment",
	"webhook.configuration",
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
	enabled_smtp_hosts: string[];
	matching_smtp_hosts: string[];
	smtp_configured: boolean;
	smtp_enabled: boolean;
	smtp_pool_exact: boolean;
	smtp_credential_binding_required: boolean;
	smtp_credentials_bound: boolean;
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
	a?(name: string): Promise<string[]>;
	aaaa?(name: string): Promise<string[]>;
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
	return name.trim();
}

function isRecordEnabled(record: Readonly<Record<string, unknown>>): boolean {
	// Listmonk serializes this setting as a boolean. Treat missing or malformed
	// values as disabled so readiness remains fail-closed.
	return record.enabled === true;
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

const NATIVE_BOUNCE_SETTING_BY_SOURCE = {
	azure: {
		directKeys: ["bounce.azure.enabled"],
		nestedKey: "bounce.azure",
	},
	forwardemail: {
		directKeys: ["bounce.forwardemail_enabled"],
		nestedKey: "bounce.forwardemail",
	},
	lettermint: {
		directKeys: ["bounce.lettermint_enabled"],
		nestedKey: "bounce.lettermint",
	},
	postmark: {
		directKeys: ["bounce.postmark_enabled"],
		nestedKey: "bounce.postmark",
	},
	sendgrid: {
		directKeys: ["bounce.sendgrid_enabled"],
	},
	ses: {
		directKeys: ["bounce.ses_enabled"],
	},
} as const;

function providerBounceSetting(
	profile: ProviderProfile,
):
	| {
			source: keyof typeof NATIVE_BOUNCE_SETTING_BY_SOURCE;
			directKeys: readonly string[];
			nestedKey?: string | undefined;
	  }
	| undefined {
	const source = (
		profile.kind === "ses" ? "ses" : profileWebhookSource(profile)
	).toLowerCase();
	if (!Object.hasOwn(NATIVE_BOUNCE_SETTING_BY_SOURCE, source)) return undefined;
	const nativeSource = source as keyof typeof NATIVE_BOUNCE_SETTING_BY_SOURCE;
	return {
		source: nativeSource,
		...NATIVE_BOUNCE_SETTING_BY_SOURCE[nativeSource],
	};
}

function providerBounceEnabled(
	profile: ProviderProfile,
	settings: Readonly<Record<string, unknown>>,
): boolean | undefined {
	const setting = providerBounceSetting(profile);
	if (setting === undefined) return undefined;
	const values = setting.directKeys
		.map((key) => settings[key])
		.filter((value): value is boolean => typeof value === "boolean");
	if (setting.nestedKey !== undefined) {
		const nested = settings[setting.nestedKey];
		if (
			typeof nested === "object" &&
			nested !== null &&
			"enabled" in nested &&
			typeof nested.enabled === "boolean"
		) {
			values.push(nested.enabled);
		}
	}
	return values.length === 0 ? undefined : values.every((value) => value);
}

function missingProviderBounceConfigurationMessage(source: string): string {
	return `Listmonk did not return ${source.toUpperCase()} bounce handling configuration.`;
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

function smtpUsernameFingerprint(
	record: Readonly<Record<string, unknown>>,
): string | undefined {
	if (typeof record.username !== "string" || record.username.length === 0) {
		return undefined;
	}
	return `sha256:${createHash("sha256").update(record.username).digest("hex")}`;
}

function awsDnsSuffix(region: string): "amazonaws.com" | "amazonaws.com.cn" {
	return region.startsWith("cn-") ? "amazonaws.com.cn" : "amazonaws.com";
}

function sesMailFromDnsSuffix(
	region: string,
): "amazonses.com" | "amazonses.com.cn" {
	return region.startsWith("cn-") ? "amazonses.com.cn" : "amazonses.com";
}

function expectedSmtpHosts(profile: ProviderProfile): string[] {
	if (profile.smtp_hosts.length > 0) return [...profile.smtp_hosts];
	if (profile.kind === "ses" && profile.region) {
		return [`email-smtp.${profile.region}.${awsDnsSuffix(profile.region)}`];
	}
	return [];
}

function setsEqual(expected: readonly string[], actual: readonly string[]): boolean {
	const expectedSet = new Set(expected);
	const actualSet = new Set(actual);
	return (
		expectedSet.size === actualSet.size &&
		[...expectedSet].every((value) => actualSet.has(value))
	);
}

function hasAmbiguousMessengerBinding(
	profile: ProviderProfile,
	profiles: readonly ProviderProfile[],
): boolean {
	const messenger = normalizeMessengerName(profile.messenger);
	return profiles.some(
		(candidate) =>
			candidate.id !== profile.id &&
			normalizeMessengerName(candidate.messenger) === messenger,
	);
}

export function inspectListmonkProviderSettings(
	profile: ProviderProfile,
	settings: Readonly<Record<string, unknown>>,
	profiles: readonly ProviderProfile[] = [profile],
): ProviderListmonkSnapshot {
	const expectedHosts = expectedSmtpHosts(profile);
	const smtp = smtpRecords(settings);
	const enabledSmtp = smtp.filter(isRecordEnabled);
	const enabledHosts = enabledSmtp
		.map(smtpHost)
		.filter((host): host is string => host !== undefined);
	const matching = smtp.filter((record) => {
		const host = smtpHost(record);
		return host !== undefined && expectedHosts.includes(host);
	});
	const smtpPoolExact =
		enabledSmtp.length === enabledHosts.length &&
		enabledSmtp.length > 0 &&
		enabledSmtp.length === expectedHosts.length &&
		setsEqual(expectedHosts, enabledHosts);
	const expectedUsernameFingerprints =
		profile.smtp_username_fingerprints;
	const actualUsernameFingerprints = enabledSmtp
		.map(smtpUsernameFingerprint)
		.filter((value): value is string => value !== undefined);
	const credentialBindingRequired =
		expectedUsernameFingerprints.length > 0;
	const smtpCredentialsBound =
		!credentialBindingRequired ||
		(enabledSmtp.length === actualUsernameFingerprints.length &&
			setsEqual(expectedUsernameFingerprints, actualUsernameFingerprints));
	const messengerName = normalizeMessengerName(profile.messenger);
	const matchingMessengers = messengerName === "email" ? matching : [];
	const messengerBindingAmbiguous = hasAmbiguousMessengerBinding(
		profile,
		profiles,
	);
	const configuredFrom =
		typeof settings["app.from_email"] === "string"
			? settings["app.from_email"]
			: undefined;
	const configuredFromDomain = fromDomain(configuredFrom);
	const nativeBounceEnabled = providerBounceEnabled(profile, settings);

	return {
		...(configuredFrom === undefined ? {} : { from_email: configuredFrom }),
		...(configuredFromDomain === undefined
			? {}
			: { from_domain: configuredFromDomain }),
		messenger: profile.messenger,
		messenger_binding_ambiguous: messengerBindingAmbiguous,
		messenger_configured:
			!messengerBindingAmbiguous &&
			matchingMessengers.length > 0 &&
			smtpPoolExact &&
			smtpCredentialsBound,
		messenger_enabled:
			!messengerBindingAmbiguous &&
			smtpPoolExact &&
			smtpCredentialsBound,
		smtp_hosts: smtp
			.map(smtpHost)
			.filter((host): host is string => host !== undefined),
		enabled_smtp_hosts: enabledHosts,
		matching_smtp_hosts: matching
			.map(smtpHost)
			.filter((host): host is string => host !== undefined),
		smtp_configured: matching.length > 0,
		smtp_enabled: smtpPoolExact && smtpCredentialsBound,
		smtp_pool_exact: smtpPoolExact,
		smtp_credential_binding_required: credentialBindingRequired,
		smtp_credentials_bound: smtpCredentialsBound,
		unsubscribe_header_enabled: settingBoolean(
			settings,
			"privacy.unsubscribe_header",
		),
		bounce_processing_enabled: settingBoolean(settings, "bounce.enabled"),
		bounce_webhooks_enabled: settingBoolean(
			settings,
			"bounce.webhooks_enabled",
		),
		...(nativeBounceEnabled === undefined
			? {}
			: { provider_bounce_enabled: nativeBounceEnabled }),
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
		messengerMessage = `Listmonk messenger '${snapshot.messenger}' is shared by multiple provider profiles. Campaigns select the complete built-in email SMTP pool; consolidate that pool into one provider profile or remove the competing profile.`;
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
				snapshot.smtp_pool_exact &&
				snapshot.smtp_credentials_bound
					? "pass"
					: "fail",
			message:
				snapshot.smtp_pool_exact &&
				snapshot.smtp_credentials_bound
					? "The complete enabled Listmonk SMTP pool matches the provider profile and required credential fingerprints."
					: "The enabled Listmonk SMTP pool or its required credential fingerprints do not exactly match the provider profile.",
			details: {
				expected_hosts: expectedSmtpHosts(profile),
				enabled_hosts: snapshot.enabled_smtp_hosts,
				matching_hosts: snapshot.matching_smtp_hosts,
				credential_binding_required:
					snapshot.smtp_credential_binding_required,
				credentials_bound: snapshot.smtp_credentials_bound,
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
	const nativeBounceSetting = providerBounceSetting(profile);
	if (nativeBounceSetting !== undefined) {
		const bounceSource = nativeBounceSetting.source;
		const providerBounceValue = snapshot.provider_bounce_enabled;
		let providerBounceStatus: DoctorCheckStatus;
		let providerBounceMessage: string;
		if (providerBounceValue === undefined) {
			providerBounceStatus = "unknown";
			providerBounceMessage =
				missingProviderBounceConfigurationMessage(bounceSource);
		} else if (providerBounceValue) {
			providerBounceStatus = "pass";
			providerBounceMessage = `${bounceSource.toUpperCase()} bounce handling is enabled.`;
		} else {
			providerBounceStatus = "fail";
			providerBounceMessage = `${bounceSource.toUpperCase()} bounce handling is disabled.`;
		}
		checks.push({
			id: `listmonk.bounce-provider.${bounceSource}`,
			status: providerBounceStatus,
			message: providerBounceMessage,
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
	const providerEnabled = providerBounceEnabled(profile, settings);
	const nativeBounceSetting = providerBounceSetting(profile);
	let configurationStatus: DoctorCheckStatus;
	let configurationMessage: string;
	if (!bounceProcessing || !bounceWebhooks || providerEnabled === false) {
		configurationStatus = "fail";
		configurationMessage =
			"Listmonk provider webhook processing is incomplete.";
	} else if (
		nativeBounceSetting !== undefined &&
		providerEnabled === undefined
	) {
		configurationStatus = "unknown";
		configurationMessage = missingProviderBounceConfigurationMessage(
			nativeBounceSetting.source,
		);
	} else {
		configurationStatus = "pass";
		configurationMessage =
			"Listmonk provider webhook processing is enabled.";
	}
	const checks: DoctorCheck[] = [
		{
			id: "webhook.configuration",
			status: configurationStatus,
			message: configurationMessage,
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
		async a(name) {
			try {
				return await withDnsTimeout(name, timeoutMs, resolve4(name));
			} catch (error) {
				if (isMissingDnsError(error)) return [];
				throw error;
			}
		},
		async aaaa(name) {
			try {
				return await withDnsTimeout(name, timeoutMs, resolve6(name));
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
	const items = record.split(";");
	for (const [index, item] of items.entries()) {
		if (!item.trim()) {
			if (index === items.length - 1 && items.length > 1) continue;
			return undefined;
		}
		const separator = item.indexOf("=");
		if (separator < 1) return undefined;
		const rawKey = item.slice(0, separator).trim();
		if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(rawKey)) return undefined;
		const key = rawKey.toLowerCase();
		const rawValue = item.slice(separator + 1).trim();
		const value = options.lowercaseValues ? rawValue.toLowerCase() : rawValue;
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

function positiveModulo(value: bigint, modulus: bigint): bigint {
	const remainder = value % modulus;
	return remainder < 0n ? remainder + modulus : remainder;
}

function modularPower(base: bigint, exponent: bigint, modulus: bigint): bigint {
	let result = 1n;
	let factor = positiveModulo(base, modulus);
	let remaining = exponent;
	while (remaining > 0n) {
		if ((remaining & 1n) === 1n) {
			result = (result * factor) % modulus;
		}
		factor = (factor * factor) % modulus;
		remaining >>= 1n;
	}
	return result;
}

function littleEndianBigInt(bytes: Uint8Array): bigint {
	let value = 0n;
	for (let index = bytes.length - 1; index >= 0; index -= 1) {
		value = (value << 8n) | BigInt(bytes[index]!);
	}
	return value;
}

interface EdwardsPoint {
	x: bigint;
	y: bigint;
}

function addEdwardsPoints(
	left: EdwardsPoint,
	right: EdwardsPoint,
): EdwardsPoint | undefined {
	const modulus = ED25519_FIELD_PRIME;
	const product = positiveModulo(
		ED25519_CURVE_D * left.x * right.x * left.y * right.y,
		modulus,
	);
	const xDenominator = positiveModulo(1n + product, modulus);
	const yDenominator = positiveModulo(1n - product, modulus);
	if (xDenominator === 0n || yDenominator === 0n) return undefined;
	return {
		x: positiveModulo(
			(left.x * right.y + left.y * right.x) *
				modularPower(xDenominator, modulus - 2n, modulus),
			modulus,
		),
		y: positiveModulo(
			(left.y * right.y + left.x * right.x) *
				modularPower(yDenominator, modulus - 2n, modulus),
			modulus,
		),
	};
}

function isValidEd25519PublicKey(publicKey: Buffer): boolean {
	if (publicKey.length !== 32) return false;
	// RFC 8032 encodes the y-coordinate in little-endian form and stores the
	// x-coordinate sign in the high bit. Decompress it so non-canonical,
	// off-curve, and small-order values cannot masquerade as usable DKIM keys.
	const encoded = littleEndianBigInt(publicKey);
	const sign = encoded >> 255n;
	const y = encoded & ((1n << 255n) - 1n);
	if (y >= ED25519_FIELD_PRIME) return false;
	const ySquared = (y * y) % ED25519_FIELD_PRIME;
	const numerator = positiveModulo(ySquared - 1n, ED25519_FIELD_PRIME);
	const denominator = positiveModulo(
		ED25519_CURVE_D * ySquared + 1n,
		ED25519_FIELD_PRIME,
	);
	if (denominator === 0n) return false;
	const xSquared = positiveModulo(
		numerator *
			modularPower(
				denominator,
				ED25519_FIELD_PRIME - 2n,
				ED25519_FIELD_PRIME,
			),
		ED25519_FIELD_PRIME,
	);
	let x = modularPower(
		xSquared,
		(ED25519_FIELD_PRIME + 3n) / 8n,
		ED25519_FIELD_PRIME,
	);
	if ((x * x) % ED25519_FIELD_PRIME !== xSquared) {
		x = (x * ED25519_SQRT_MINUS_ONE) % ED25519_FIELD_PRIME;
	}
	if ((x * x) % ED25519_FIELD_PRIME !== xSquared) return false;
	if (x === 0n && sign === 1n) return false;
	if ((x & 1n) !== sign) x = ED25519_FIELD_PRIME - x;

	let multiplied: EdwardsPoint = { x, y };
	for (let index = 0; index < 3; index += 1) {
		const doubled = addEdwardsPoints(multiplied, multiplied);
		if (doubled === undefined) return false;
		multiplied = doubled;
	}
	if (multiplied.x === 0n && multiplied.y === 1n) return false;
	try {
		// Confirm that the platform crypto implementation also recognizes the
		// validated raw point when wrapped in its standard SPKI envelope.
		const key = createPublicKey({
			key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey]),
			format: "der",
			type: "spki",
		});
		return key.asymmetricKeyType === "ed25519";
	} catch {
		return false;
	}
}

function allowsEmailDkimService(
	tags: ReadonlyMap<string, string>,
): boolean {
	const service = tags.get("s");
	if (service === undefined) return true;
	const services = service
		.split(":")
		.map((value) => value.trim().toLowerCase());
	return (
		services.length > 0 &&
		services.every(Boolean) &&
		(services.includes("*") || services.includes("email"))
	);
}

function allowsSha256DkimHash(tags: ReadonlyMap<string, string>): boolean {
	const hashAlgorithms = tags.get("h");
	if (hashAlgorithms === undefined) return true;
	const algorithms = hashAlgorithms
		.split(":")
		.map((value) => value.trim().toLowerCase());
	return (
		algorithms.length > 0 &&
		algorithms.every(Boolean) &&
		algorithms.includes("sha256")
	);
}

function startsWithTag(record: string, expectedTag: string): boolean {
	const first = record.split(";", 1)[0]!;
	const separator = first.indexOf("=");
	return (
		separator > 0 &&
		first.slice(0, separator).trim().toLowerCase() === expectedTag
	);
}

function isValidRsaDkimPublicKey(publicKey: Buffer): boolean {
	for (const type of ["spki", "pkcs1"] as const) {
		try {
			const key = createPublicKey({
				key: publicKey,
				format: "der",
				type,
			});
			if (
				key.asymmetricKeyType === "rsa" &&
				(key.asymmetricKeyDetails?.modulusLength ?? 0) >= 1_024
			) {
				return true;
			}
		} catch {
			// RFC 6376 names RSAPublicKey while common DKIM tooling emits
			// SubjectPublicKeyInfo, so validate both DER encodings.
		}
	}
	return false;
}

function hasDirectDkimKey(record: string): boolean {
	const tags = parseTagRecord(record);
	const version = tags?.get("v")?.toLowerCase();
	if (
		tags === undefined ||
		(version !== undefined && version !== "dkim1") ||
		(version !== undefined && !startsWithTag(record, "v")) ||
		!allowsEmailDkimService(tags) ||
		!allowsSha256DkimHash(tags)
	) {
		return false;
	}
	const encoded = tags.get("p")?.replace(/\s+/g, "");
	if (!encoded) return false;
	const unpadded = encoded.replace(/=+$/, "");
	if (
		!/^[A-Za-z0-9+/]+$/.test(unpadded) ||
		unpadded.length % 4 === 1
	) {
		return false;
	}
	const normalized =
		unpadded + "=".repeat((4 - (unpadded.length % 4)) % 4);
	if (encoded !== unpadded && encoded !== normalized) return false;
	const publicKey = Buffer.from(normalized, "base64");
	if (
		publicKey.length === 0 ||
		publicKey.toString("base64").replace(/=+$/, "") !== unpadded
	) {
		return false;
	}
	const keyType = tags.get("k")?.toLowerCase() ?? "rsa";
	if (keyType === "ed25519") return isValidEd25519PublicKey(publicKey);
	if (keyType === "rsa") return isValidRsaDkimPublicKey(publicKey);
	return false;
}

function hasSingleDirectDkimKey(records: readonly string[]): boolean {
	return records.length === 1 && hasDirectDkimKey(records[0]!);
}

function validDkimOwnerName(selector: string, domain: string): boolean {
	return (
		selector.length <= 253 &&
		/^(?:[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?)(?:\.(?:[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?))*$/.test(
			selector,
		) &&
		`${selector}._domainkey.${domain}`.length <= 253
	);
}

function isSpfVersionOneRecord(record: string): boolean {
	return record.trim().split(/\s+/, 1)[0]?.toLowerCase() === "v=spf1";
}

interface SpfAuthorizationInspection {
	ready: boolean;
	unconditional_pass?: boolean | undefined;
	indeterminate: boolean;
	invalid: boolean;
	observations: DnsObservation[];
}

interface SpfLookupBudget {
	used: number;
	void: number;
}

function consumeSpfDnsLookup(budget: SpfLookupBudget): boolean {
	if (budget.used >= MAX_SPF_DNS_LOOKUPS) return false;
	budget.used += 1;
	return true;
}

function consumeSpfVoidLookups(
	budget: SpfLookupBudget,
	count = 1,
): boolean {
	budget.void += count;
	return budget.void <= MAX_SPF_VOID_LOOKUPS;
}

function isValidSpfDomainSpec(value: string): boolean {
	return (
		value.length > 0 &&
		!value.includes("/") &&
		normalizeDomain(value) !== ""
	);
}

function isValidSpfIpNetwork(
	value: string,
	family: 4 | 6,
	maxPrefixLength: number,
): boolean {
	const separator = value.lastIndexOf("/");
	const address = separator === -1 ? value : value.slice(0, separator);
	const prefix = separator === -1 ? undefined : value.slice(separator + 1);
	if (address.includes("%")) return false;
	if (isIP(address) !== family) return false;
	if (prefix === undefined) return true;
	if (!/^\d+$/.test(prefix)) return false;
	const prefixLength = Number(prefix);
	return prefixLength >= 0 && prefixLength <= maxPrefixLength;
}

function isValidSpfDualCidrMechanism(mechanism: string): boolean {
	const match =
		/^(?:a|mx)(?::([^/]+))?(?:\/(\d+))?(?:\/\/(\d+))?$/i.exec(mechanism);
	if (match === null) return false;
	const domain = match[1];
	const ipv4Prefix = match[2];
	const ipv6Prefix = match[3];
	return (
		(domain === undefined || isValidSpfDomainSpec(domain)) &&
		(ipv4Prefix === undefined || Number(ipv4Prefix) <= 32) &&
		(ipv6Prefix === undefined || Number(ipv6Prefix) <= 128)
	);
}

function isValidSpfMechanism(mechanism: string): boolean {
	const lower = mechanism.toLowerCase();
	if (lower === "all") return true;
	if (lower.startsWith("include:")) {
		return isValidSpfDomainSpec(mechanism.slice("include:".length));
	}
	if (lower.startsWith("ip4:")) {
		return isValidSpfIpNetwork(mechanism.slice("ip4:".length), 4, 32);
	}
	if (lower.startsWith("ip6:")) {
		return isValidSpfIpNetwork(mechanism.slice("ip6:".length), 6, 128);
	}
	if (lower === "a" || lower.startsWith("a:") || lower.startsWith("a/")) {
		return isValidSpfDualCidrMechanism(mechanism);
	}
	if (
		lower === "mx" ||
		lower.startsWith("mx:") ||
		lower.startsWith("mx/")
	) {
		return isValidSpfDualCidrMechanism(mechanism);
	}
	if (lower === "ptr") return true;
	if (lower.startsWith("ptr:")) {
		return isValidSpfDomainSpec(mechanism.slice("ptr:".length));
	}
	if (lower.startsWith("exists:")) {
		return isValidSpfDomainSpec(mechanism.slice("exists:".length));
	}
	return false;
}

function isDirectSpfAuthorizer(mechanism: string): boolean {
	const name = mechanism.toLowerCase().split(/[:/]/, 1)[0];
	return name !== "include" && isValidSpfMechanism(mechanism);
}

function spfMechanismUsesDns(mechanism: string): boolean {
	const name = mechanism.toLowerCase().split(/[:/]/, 1)[0];
	return (
		name === "a" ||
		name === "mx" ||
		name === "ptr" ||
		name === "exists"
	);
}

function parseValidSpfTerms(record: string): string[] | undefined {
	if (!isSpfVersionOneRecord(record)) return undefined;
	const terms = record.trim().split(/\s+/).slice(1);
	const seenModifiers = new Set<string>();
	for (const term of terms) {
		const modifier = /^([a-z][a-z0-9._-]*)=(.*)$/i.exec(term);
		if (modifier !== null) {
			const name = modifier[1]!.toLowerCase();
			if (seenModifiers.has(name)) return undefined;
			seenModifiers.add(name);
			if (
				name === "redirect" &&
				!isValidSpfDomainSpec(modifier[2]!)
			) {
				return undefined;
			}
			continue;
		}
		const mechanism = term.replace(/^[+?~-]/, "");
		if (!isValidSpfMechanism(mechanism)) return undefined;
	}
	return terms;
}

interface SpfMechanismMatch {
	matches: boolean;
	indeterminate: boolean;
	invalid: boolean;
}

async function inspectSpfAddresses(
	domain: string,
	dns: ProviderDnsResolver,
	ipv4Only = false,
	lookupBudget?: SpfLookupBudget,
): Promise<SpfMechanismMatch> {
	if (domain.includes("%")) {
		return { matches: false, indeterminate: true, invalid: false };
	}
	const loaders: Array<(() => Promise<string[]>) | undefined> = [
		dns.a === undefined ? undefined : () => dns.a!(domain),
		...(ipv4Only
			? []
			: [dns.aaaa === undefined ? undefined : () => dns.aaaa!(domain)]),
	];
	const available = loaders.filter(
		(load): load is () => Promise<string[]> => load !== undefined,
	);
	const results = await Promise.allSettled(available.map((load) => load()));
	const voidLookups = results.filter(
		(result) => result.status === "fulfilled" && result.value.length === 0,
	).length;
	if (
		lookupBudget !== undefined &&
		voidLookups > 0 &&
		!consumeSpfVoidLookups(lookupBudget, voidLookups)
	) {
		return { matches: false, indeterminate: false, invalid: true };
	}
	if (
		results.some(
			(result) => result.status === "fulfilled" && result.value.length > 0,
		)
	) {
		return { matches: true, indeterminate: false, invalid: false };
	}
	if (
		available.length !== loaders.length ||
		results.some((result) => result.status === "rejected")
	) {
		return { matches: false, indeterminate: true, invalid: false };
	}
	return { matches: false, indeterminate: false, invalid: false };
}

function spfMechanismDomain(
	mechanism: string,
	currentDomain: string,
): string {
	const separator = mechanism.indexOf(":");
	if (separator === -1) return currentDomain;
	return normalizeDomain(mechanism.slice(separator + 1).split("/", 1)[0]!);
}

async function inspectDirectSpfMechanism(
	mechanism: string,
	currentDomain: string,
	dns: ProviderDnsResolver,
	lookupBudget?: SpfLookupBudget,
): Promise<SpfMechanismMatch> {
	const name = mechanism.toLowerCase().split(/[:/]/, 1)[0];
	if (name === "ip4" || name === "ip6" || name === "all") {
		return { matches: true, indeterminate: false, invalid: false };
	}
	if (name === "a") {
		return inspectSpfAddresses(
			spfMechanismDomain(mechanism, currentDomain),
			dns,
			false,
			lookupBudget,
		);
	}
	if (name === "exists") {
		return inspectSpfAddresses(
			spfMechanismDomain(mechanism, currentDomain),
			dns,
			true,
			lookupBudget,
		);
	}
	if (name === "mx") {
		const domain = spfMechanismDomain(mechanism, currentDomain);
		if (domain.includes("%")) {
			return { matches: false, indeterminate: true, invalid: false };
		}
		let records: Array<{ exchange: string; priority: number }>;
		try {
			records = await dns.mx(domain);
		} catch {
			return { matches: false, indeterminate: true, invalid: false };
		}
		if (records.length > 10) {
			return { matches: false, indeterminate: false, invalid: true };
		}
		if (
			records.length === 0 &&
			lookupBudget !== undefined &&
			!consumeSpfVoidLookups(lookupBudget)
		) {
			return { matches: false, indeterminate: false, invalid: true };
		}
		const exchanges = records
			.map(({ exchange }) => normalizeDomain(exchange))
			.filter(Boolean);
		const results = await Promise.all(
			exchanges.map((exchange) =>
				inspectSpfAddresses(exchange, dns, false, lookupBudget),
			),
		);
		if (results.some(({ invalid }) => invalid)) {
			return { matches: false, indeterminate: false, invalid: true };
		}
		if (results.some(({ matches }) => matches)) {
			return { matches: true, indeterminate: false, invalid: false };
		}
		if (results.some(({ indeterminate }) => indeterminate)) {
			return { matches: false, indeterminate: true, invalid: false };
		}
		return { matches: false, indeterminate: false, invalid: false };
	}
	// PTR depends on the sender address and forward-confirmed reverse DNS.
	return { matches: false, indeterminate: true, invalid: false };
}

interface SpfExpectedIncludeInspection {
	found: boolean;
	indeterminate: boolean;
	invalid: boolean;
	observations: DnsObservation[];
	lookupBudget: SpfLookupBudget;
}

async function inspectSpfExpectedIncludePath(
	record: string,
	currentDomain: string,
	expectedDomain: string,
	dns: ProviderDnsResolver,
): Promise<SpfExpectedIncludeInspection> {
	const terms = parseValidSpfTerms(record);
	const lookupBudget: SpfLookupBudget = { used: 0, void: 0 };
	const observations: DnsObservation[] = [];
	if (terms === undefined) {
		return {
			found: false,
			indeterminate: false,
			invalid: true,
			observations,
			lookupBudget,
		};
	}
	const expected = normalizeDomain(expectedDomain);
	const visited = new Set([normalizeDomain(currentDomain)]);
	for (const term of terms) {
		if (term.includes("=")) continue;
		const qualifier = /^[+?~-]/.exec(term)?.[0];
		const mechanism = term.replace(/^[+?~-]/, "");
		const mechanismName = mechanism
			.toLowerCase()
			.split(/[:/]/, 1)[0];
		if (mechanismName === "all") {
			return {
				found: false,
				indeterminate: false,
				invalid: false,
				observations,
				lookupBudget,
			};
		}
		if (
			(mechanismName === "include" ||
				spfMechanismUsesDns(mechanism)) &&
			!consumeSpfDnsLookup(lookupBudget)
		) {
			return {
				found: false,
				indeterminate: false,
				invalid: true,
				observations,
				lookupBudget,
			};
		}
		if (mechanismName === "include") {
			const nestedDomain = mechanism.slice("include:".length);
			if (
				(qualifier === undefined || qualifier === "+") &&
				normalizeDomain(nestedDomain) === expected
			) {
				return {
					found: true,
					indeterminate: false,
					invalid: false,
					observations,
					lookupBudget,
				};
			}
			const nested = await inspectSpfAuthorizationTarget(
				nestedDomain,
				dns,
				visited,
				lookupBudget,
			);
			observations.push(...nested.observations);
			if (nested.indeterminate || nested.invalid) {
				return {
					found: false,
					indeterminate: nested.indeterminate,
					invalid: nested.invalid,
					observations,
					lookupBudget,
				};
			}
			if (nested.unconditional_pass === true) {
				return {
					found: false,
					indeterminate: false,
					invalid: false,
					observations,
					lookupBudget,
				};
			}
			continue;
		}
		if (!spfMechanismUsesDns(mechanism)) continue;
		const match = await inspectDirectSpfMechanism(
			mechanism,
			currentDomain,
			dns,
			lookupBudget,
		);
		if (match.indeterminate || match.invalid) {
			return {
				found: false,
				indeterminate: match.indeterminate,
				invalid: match.invalid,
				observations,
				lookupBudget,
			};
		}
	}
	return {
		found: false,
		indeterminate: false,
		invalid: false,
		observations,
		lookupBudget,
	};
}

async function inspectSpfAuthorizationTarget(
	domain: string,
	dns: ProviderDnsResolver,
	visited: ReadonlySet<string> = new Set(),
	lookupBudget: SpfLookupBudget = { used: 1, void: 0 },
	preloadedSpfRecord?: string,
): Promise<SpfAuthorizationInspection> {
	const normalizedDomain = normalizeDomain(domain);
	if (
		lookupBudget.used > MAX_SPF_DNS_LOOKUPS ||
		visited.has(normalizedDomain)
	) {
		return {
			ready: false,
			indeterminate: false,
			invalid: true,
			observations: [],
		};
	}
	if (normalizedDomain.includes("%")) {
		return {
			ready: false,
			indeterminate: true,
			invalid: false,
			observations: [],
		};
	}
	const lookup =
		preloadedSpfRecord === undefined
			? await resolveDnsObservation(normalizedDomain, "TXT", () =>
					dns.txt(normalizedDomain),
				)
			: {
					outcome: "found" as const,
					values: [preloadedSpfRecord],
					observation: {
						name: normalizedDomain,
						type: "TXT" as const,
						values: [preloadedSpfRecord],
					},
				};
	const observations = [lookup.observation];
	if (lookup.outcome === "error") {
		return {
			ready: false,
			indeterminate: true,
			invalid: false,
			observations,
		};
	}
	if (
		lookup.values.length === 0 &&
		!consumeSpfVoidLookups(lookupBudget)
	) {
		return {
			ready: false,
			indeterminate: false,
			invalid: true,
			observations,
		};
	}
	const records = lookup.values.filter(isSpfVersionOneRecord);
	if (records.length !== 1) {
		return {
			ready: false,
			indeterminate: false,
			invalid: true,
			observations,
		};
	}
	const terms = parseValidSpfTerms(records[0]!);
	if (terms === undefined) {
		return {
			ready: false,
			indeterminate: false,
			invalid: true,
			observations,
		};
	}
	const nextVisited = new Set(visited);
	nextVisited.add(normalizedDomain);
	let redirectTarget: string | undefined;
	// SPF terms are intentionally evaluated in order: an earlier terminal
	// mechanism or nested lookup error determines whether later paths matter.
	for (const term of terms) {
		const redirect = /^redirect=(.+)$/i.exec(term);
		if (redirect) {
			redirectTarget = redirect[1];
			continue;
		}
		if (term.includes("=")) continue;
		const qualifier = /^[+?~-]/.exec(term)?.[0];
		const mechanism = term.replace(/^[+?~-]/, "");
		const mechanismName = mechanism
			.toLowerCase()
			.split(/[:/]/, 1)[0];
		if (mechanismName === "all") {
			return {
				ready:
					(qualifier === undefined || qualifier === "+") &&
					isDirectSpfAuthorizer(mechanism),
				...((qualifier === undefined || qualifier === "+") &&
				isDirectSpfAuthorizer(mechanism)
					? { unconditional_pass: true }
					: {}),
				indeterminate: false,
				invalid: false,
				observations,
			};
		}
		if (mechanismName === "include") {
			const nestedDomain = mechanism.slice("include:".length);
			if (!nestedDomain) continue;
			if (!consumeSpfDnsLookup(lookupBudget)) {
				return {
					ready: false,
					indeterminate: false,
					invalid: true,
					observations,
				};
			}
			const nested = await inspectSpfAuthorizationTarget(
				nestedDomain,
				dns,
				nextVisited,
				lookupBudget,
			);
			observations.push(...nested.observations);
			if (nested.indeterminate) {
				return {
					ready: false,
					indeterminate: true,
					invalid: false,
					observations,
				};
			}
			if (nested.invalid) {
				return {
					ready: false,
					indeterminate: false,
					invalid: true,
					observations,
				};
			}
			if (
				nested.ready &&
				(qualifier === undefined || qualifier === "+")
			) {
				return {
					ready: true,
					...(nested.unconditional_pass === true
						? { unconditional_pass: true }
						: {}),
					indeterminate: false,
					invalid: false,
					observations,
				};
			}
			if (nested.ready) {
				return {
					ready: false,
					indeterminate: false,
					invalid: false,
					observations,
				};
			}
			continue;
		}
		if (
			spfMechanismUsesDns(mechanism) &&
			!consumeSpfDnsLookup(lookupBudget)
		) {
			return {
				ready: false,
				indeterminate: false,
				invalid: true,
				observations,
			};
		}
		const match = await inspectDirectSpfMechanism(
			mechanism,
			normalizedDomain,
			dns,
			lookupBudget,
		);
		if (match.indeterminate) {
			return {
				ready: false,
				indeterminate: true,
				invalid: false,
				observations,
			};
		}
		if (match.invalid) {
			return {
				ready: false,
				indeterminate: false,
				invalid: true,
				observations,
			};
		}
		if (!match.matches) continue;
		if (qualifier !== undefined && qualifier !== "+") {
			return {
				ready: false,
				indeterminate: false,
				invalid: false,
				observations,
			};
		}
		if (isDirectSpfAuthorizer(mechanism)) {
			return {
				ready: true,
				indeterminate: false,
				invalid: false,
				observations,
			};
		}
	}
	if (redirectTarget !== undefined) {
		if (!consumeSpfDnsLookup(lookupBudget)) {
			return {
				ready: false,
				indeterminate: false,
				invalid: true,
				observations,
			};
		}
		const redirected = await inspectSpfAuthorizationTarget(
			redirectTarget,
			dns,
			nextVisited,
			lookupBudget,
		);
		observations.push(...redirected.observations);
		return {
			ready: redirected.ready,
			...(redirected.unconditional_pass === undefined
				? {}
				: {
						unconditional_pass:
							redirected.unconditional_pass,
					}),
			indeterminate: redirected.indeterminate,
			invalid: redirected.invalid,
			observations,
		};
	}
	return {
		ready: false,
		indeterminate: false,
		invalid: false,
		observations,
	};
}

interface SpfIpInterval {
	family: 4 | 6;
	start: bigint;
	end: bigint;
}

function ipv4Integer(address: string): bigint | undefined {
	if (isIP(address) !== 4) return undefined;
	return address
		.split(".")
		.reduce((value, part) => (value << 8n) | BigInt(part), 0n);
}

function ipv6Integer(address: string): bigint | undefined {
	if (address.includes("%") || isIP(address) !== 6) return undefined;
	let normalized = address.toLowerCase();
	const lastColon = normalized.lastIndexOf(":");
	const possibleIpv4 = normalized.slice(lastColon + 1);
	if (possibleIpv4.includes(".")) {
		const ipv4 = ipv4Integer(possibleIpv4);
		if (ipv4 === undefined) return undefined;
		normalized = `${normalized.slice(0, lastColon)}:${Number(
			(ipv4 >> 16n) & 0xffffn,
		).toString(16)}:${Number(ipv4 & 0xffffn).toString(16)}`;
	}
	const compression = normalized.split("::");
	if (compression.length > 2) return undefined;
	const left = compression[0] ? compression[0].split(":") : [];
	const right =
		compression.length === 2 && compression[1] ? compression[1].split(":") : [];
	const missing =
		compression.length === 2 ? 8 - left.length - right.length : 0;
	const parts =
		compression.length === 2
			? [...left, ...Array<string>(missing).fill("0"), ...right]
			: left;
	if (parts.length !== 8 || parts.some((part) => part.length === 0)) {
		return undefined;
	}
	try {
		return parts.reduce(
			(value, part) => (value << 16n) | BigInt(`0x${part}`),
			0n,
		);
	} catch {
		return undefined;
	}
}

function parseSpfIpInterval(value: string): SpfIpInterval | undefined {
	const normalized = value.toLowerCase();
	const separator = normalized.lastIndexOf("/");
	const address =
		separator === -1 ? normalized : normalized.slice(0, separator);
	if (address.includes("%")) return undefined;
	const family = isIP(address);
	if (family !== 4 && family !== 6) return undefined;
	const maximumPrefix = family === 4 ? 32 : 128;
	const prefix =
		separator === -1 ? maximumPrefix : Number(normalized.slice(separator + 1));
	if (
		!Number.isInteger(prefix) ||
		prefix < 0 ||
		prefix > maximumPrefix
	) {
		return undefined;
	}
	const addressValue =
		family === 4 ? ipv4Integer(address) : ipv6Integer(address);
	if (addressValue === undefined) return undefined;
	const hostBits = BigInt(maximumPrefix - prefix);
	const start = (addressValue >> hostBits) << hostBits;
	const hostMask = hostBits === 0n ? 0n : (1n << hostBits) - 1n;
	return {
		family,
		start,
		end: start | hostMask,
	};
}

function intervalsOverlap(
	left: SpfIpInterval,
	right: SpfIpInterval,
): boolean {
	return (
		left.family === right.family &&
		left.start <= right.end &&
		right.start <= left.end
	);
}

function subtractSpfInterval(
	source: SpfIpInterval,
	authorized: SpfIpInterval,
): SpfIpInterval[] {
	if (!intervalsOverlap(source, authorized)) return [source];
	const remaining: SpfIpInterval[] = [];
	if (source.start < authorized.start) {
		remaining.push({
			family: source.family,
			start: source.start,
			end: authorized.start - 1n,
		});
	}
	if (authorized.end < source.end) {
		remaining.push({
			family: source.family,
			start: authorized.end + 1n,
			end: source.end,
		});
	}
	return remaining;
}

function normalizeSpfIntervals(
	ranges: readonly SpfIpInterval[],
): SpfIpInterval[] {
	const sorted = [...ranges].sort((left, right) => {
		if (left.family !== right.family) return left.family - right.family;
		if (left.start < right.start) return -1;
		if (left.start > right.start) return 1;
		if (left.end < right.end) return -1;
		if (left.end > right.end) return 1;
		return 0;
	});
	const normalized: SpfIpInterval[] = [];
	for (const range of sorted) {
		const previous = normalized.at(-1);
		if (
			previous === undefined ||
			previous.family !== range.family ||
			range.start > previous.end + 1n
		) {
			normalized.push({ ...range });
			continue;
		}
		if (range.end > previous.end) previous.end = range.end;
	}
	return normalized;
}

function intersectSpfIntervals(
	left: readonly SpfIpInterval[],
	right: readonly SpfIpInterval[],
): SpfIpInterval[] {
	const intersections: SpfIpInterval[] = [];
	for (const leftRange of left) {
		for (const rightRange of right) {
			if (!intervalsOverlap(leftRange, rightRange)) continue;
			intersections.push({
				family: leftRange.family,
				start:
					leftRange.start > rightRange.start
						? leftRange.start
						: rightRange.start,
				end:
					leftRange.end < rightRange.end
						? leftRange.end
						: rightRange.end,
			});
		}
	}
	return normalizeSpfIntervals(intersections);
}

function subtractSpfIntervals(
	source: readonly SpfIpInterval[],
	removed: readonly SpfIpInterval[],
): SpfIpInterval[] {
	let remaining = normalizeSpfIntervals(source);
	for (const range of normalizeSpfIntervals(removed)) {
		remaining = remaining.flatMap((candidate) =>
			subtractSpfInterval(candidate, range),
		);
	}
	return normalizeSpfIntervals(remaining);
}

interface ExpectedSpfInspection extends SpfAuthorizationInspection {
	remaining: SpfIpInterval[];
}

function expectedSpfInspection(
	remaining: readonly SpfIpInterval[],
	options: {
		indeterminate?: boolean;
		invalid?: boolean;
		observations?: DnsObservation[];
		unconditionalPass?: boolean;
	} = {},
): ExpectedSpfInspection {
	const normalizedRemaining = normalizeSpfIntervals(remaining);
	const indeterminate = options.indeterminate ?? false;
	const invalid = options.invalid ?? false;
	const ready =
		normalizedRemaining.length === 0 && !indeterminate && !invalid;
	return {
		ready,
		...(ready && options.unconditionalPass === true
			? { unconditional_pass: true }
			: {}),
		indeterminate,
		invalid,
		observations: options.observations ?? [],
		remaining: normalizedRemaining,
	};
}

interface ExpectedSpfDnsMatch {
	intervals: SpfIpInterval[];
	matchesAll: boolean;
	indeterminate: boolean;
	invalid: boolean;
}

function spfAddressPrefixes(mechanism: string): {
	ipv4: number;
	ipv6: number;
} {
	const match =
		/^(?:a|mx)(?::([^/]+))?(?:\/(\d+))?(?:\/\/(\d+))?$/i.exec(mechanism);
	return {
		ipv4: match?.[2] === undefined ? 32 : Number(match[2]),
		ipv6: match?.[3] === undefined ? 128 : Number(match[3]),
	};
}

async function resolveExpectedSpfAddressIntervals(
	domain: string,
	expectedRanges: readonly SpfIpInterval[],
	prefixes: Readonly<{ ipv4: number; ipv6: number }>,
	dns: ProviderDnsResolver,
	lookupBudget: SpfLookupBudget,
): Promise<ExpectedSpfDnsMatch> {
	if (domain.includes("%")) {
		return {
			intervals: [],
			matchesAll: false,
			indeterminate: true,
			invalid: false,
		};
	}
	const families = new Set(expectedRanges.map(({ family }) => family));
	const available: Array<{
		family: 4 | 6;
		load: () => Promise<string[]>;
	}> = [];
	for (const family of families) {
		if (family === 4) {
			if (dns.a === undefined) {
				return {
					intervals: [],
					matchesAll: false,
					indeterminate: true,
					invalid: false,
				};
			}
			available.push({ family, load: () => dns.a!(domain) });
			continue;
		}
		if (dns.aaaa === undefined) {
			return {
				intervals: [],
				matchesAll: false,
				indeterminate: true,
				invalid: false,
			};
		}
		available.push({ family, load: () => dns.aaaa!(domain) });
	}
	const results = await Promise.allSettled(
		available.map(async ({ family, load }) => ({
			family,
			addresses: await load(),
		})),
	);
	const voidLookups = results.filter(
		(result) =>
			result.status === "fulfilled" &&
			result.value.addresses.length === 0,
	).length;
	if (
		voidLookups > 0 &&
		!consumeSpfVoidLookups(lookupBudget, voidLookups)
	) {
		return {
			intervals: [],
			matchesAll: false,
			indeterminate: false,
			invalid: true,
		};
	}
	if (results.some((result) => result.status === "rejected")) {
		return {
			intervals: [],
			matchesAll: false,
			indeterminate: true,
			invalid: false,
		};
	}
	const intervals: SpfIpInterval[] = [];
	for (const result of results) {
		if (result.status !== "fulfilled") continue;
		const prefix =
			result.value.family === 4 ? prefixes.ipv4 : prefixes.ipv6;
		for (const address of result.value.addresses) {
			const interval = parseSpfIpInterval(`${address}/${prefix}`);
			if (
				interval === undefined ||
				interval.family !== result.value.family
			) {
				return {
					intervals: [],
					matchesAll: false,
					indeterminate: false,
					invalid: true,
				};
			}
			intervals.push(interval);
		}
	}
	return {
		intervals: normalizeSpfIntervals(intervals),
		matchesAll: false,
		indeterminate: false,
		invalid: false,
	};
}

async function inspectExpectedSpfDnsMechanism(
	mechanism: string,
	currentDomain: string,
	expectedRanges: readonly SpfIpInterval[],
	dns: ProviderDnsResolver,
	lookupBudget: SpfLookupBudget,
): Promise<ExpectedSpfDnsMatch> {
	const mechanismName = mechanism
		.toLowerCase()
		.split(/[:/]/, 1)[0];
	if (mechanismName === "exists") {
		const match = await inspectDirectSpfMechanism(
			mechanism,
			currentDomain,
			dns,
			lookupBudget,
		);
		return {
			intervals: [],
			matchesAll: match.matches,
			indeterminate: match.indeterminate,
			invalid: match.invalid,
		};
	}
	if (mechanismName === "ptr") {
		return {
			intervals: [],
			matchesAll: false,
			indeterminate: true,
			invalid: false,
		};
	}
	const prefixes = spfAddressPrefixes(mechanism);
	const domain = spfMechanismDomain(mechanism, currentDomain);
	if (mechanismName === "a") {
		return resolveExpectedSpfAddressIntervals(
			domain,
			expectedRanges,
			prefixes,
			dns,
			lookupBudget,
		);
	}
	if (mechanismName !== "mx" || domain.includes("%")) {
		return {
			intervals: [],
			matchesAll: false,
			indeterminate: domain.includes("%"),
			invalid: mechanismName !== "mx",
		};
	}
	let records: Array<{ exchange: string; priority: number }>;
	try {
		records = await dns.mx(domain);
	} catch {
		return {
			intervals: [],
			matchesAll: false,
			indeterminate: true,
			invalid: false,
		};
	}
	if (records.length > 10) {
		return {
			intervals: [],
			matchesAll: false,
			indeterminate: false,
			invalid: true,
		};
	}
	if (
		records.length === 0 &&
		!consumeSpfVoidLookups(lookupBudget)
	) {
		return {
			intervals: [],
			matchesAll: false,
			indeterminate: false,
			invalid: true,
		};
	}
	const intervals: SpfIpInterval[] = [];
	for (const { exchange } of records) {
		const normalizedExchange = normalizeDomain(exchange);
		if (
			normalizedExchange.length === 0 ||
			normalizedExchange.includes("%")
		) {
			return {
				intervals: [],
				matchesAll: false,
				indeterminate: false,
				invalid: true,
			};
		}
		const resolved = await resolveExpectedSpfAddressIntervals(
			normalizedExchange,
			expectedRanges,
			prefixes,
			dns,
			lookupBudget,
		);
		if (resolved.indeterminate || resolved.invalid) return resolved;
		intervals.push(...resolved.intervals);
	}
	return {
		intervals: normalizeSpfIntervals(intervals),
		matchesAll: false,
		indeterminate: false,
		invalid: false,
	};
}

async function inspectExpectedSpfDomain(
	domain: string,
	expectedRanges: readonly SpfIpInterval[],
	dns: ProviderDnsResolver,
	lookupBudget: SpfLookupBudget,
	visited: ReadonlySet<string>,
): Promise<ExpectedSpfInspection> {
	const normalizedDomain = normalizeDomain(domain);
	if (
		normalizedDomain.includes("%") ||
		visited.has(normalizedDomain)
	) {
		return expectedSpfInspection(expectedRanges, {
			indeterminate: normalizedDomain.includes("%"),
			invalid: visited.has(normalizedDomain),
		});
	}
	const lookup = await resolveDnsObservation(normalizedDomain, "TXT", () =>
		dns.txt(normalizedDomain),
	);
	const observations = [lookup.observation];
	if (lookup.outcome === "error") {
		return expectedSpfInspection(expectedRanges, {
			indeterminate: true,
			observations,
		});
	}
	if (
		lookup.values.length === 0 &&
		!consumeSpfVoidLookups(lookupBudget)
	) {
		return expectedSpfInspection(expectedRanges, {
			invalid: true,
			observations,
		});
	}
	const records = lookup.values.filter(isSpfVersionOneRecord);
	if (records.length !== 1) {
		return expectedSpfInspection(expectedRanges, {
			invalid: true,
			observations,
		});
	}
	const nextVisited = new Set(visited);
	nextVisited.add(normalizedDomain);
	const nested = await inspectExpectedSpfRecord(
		records[0]!,
		normalizedDomain,
		expectedRanges,
		dns,
		lookupBudget,
		nextVisited,
		true,
	);
	return {
		...nested,
		observations: [...observations, ...nested.observations],
	};
}

async function inspectExpectedSpfRecord(
	record: string,
	currentDomain: string,
	expectedRanges: readonly SpfIpInterval[],
	dns: ProviderDnsResolver,
	lookupBudget: SpfLookupBudget,
	visited: ReadonlySet<string>,
	allowUnscopedPass: boolean,
): Promise<ExpectedSpfInspection> {
	const terms = parseValidSpfTerms(record);
	if (terms === undefined || expectedRanges.length === 0) {
		return expectedSpfInspection(expectedRanges, {
			invalid: terms === undefined,
		});
	}
	let remaining = normalizeSpfIntervals(expectedRanges);
	let terminalNotPass: SpfIpInterval[] = [];
	const observations: DnsObservation[] = [];
	let redirectTarget: string | undefined;
	for (const term of terms) {
		const redirect = /^redirect=(.+)$/i.exec(term);
		if (redirect !== null) {
			redirectTarget = redirect[1];
			continue;
		}
		if (term.includes("=")) continue;
		const qualifier = /^[+?~-]/.exec(term)?.[0];
		const mechanism = term.replace(/^[+?~-]/, "");
		const mechanismName = mechanism
			.toLowerCase()
			.split(/[:/]/, 1)[0];
		if (mechanismName === "all") {
			if (
				allowUnscopedPass &&
				(qualifier === undefined || qualifier === "+")
			) {
				remaining = [];
				return expectedSpfInspection(terminalNotPass, {
					observations,
					unconditionalPass: terminalNotPass.length === 0,
				});
			}
			terminalNotPass = normalizeSpfIntervals([
				...terminalNotPass,
				...remaining,
			]);
			remaining = [];
			return expectedSpfInspection(terminalNotPass, {
				observations,
			});
		}
		if (mechanismName === "ip4" || mechanismName === "ip6") {
			const mechanismRange = parseSpfIpInterval(mechanism.slice(4));
			if (mechanismRange === undefined) {
				return expectedSpfInspection([...terminalNotPass, ...remaining], {
					invalid: true,
					observations,
				});
			}
			const matched = intersectSpfIntervals(remaining, [mechanismRange]);
			if (matched.length === 0) continue;
			remaining = subtractSpfIntervals(remaining, matched);
			if (qualifier !== undefined && qualifier !== "+") {
				terminalNotPass = normalizeSpfIntervals([
					...terminalNotPass,
					...matched,
				]);
			}
			if (remaining.length === 0) {
				return expectedSpfInspection(terminalNotPass, {
					observations,
				});
			}
			continue;
		}
		if (
			mechanismName !== "include" &&
			!spfMechanismUsesDns(mechanism)
		) {
			continue;
		}
		if (!consumeSpfDnsLookup(lookupBudget)) {
			return expectedSpfInspection([...terminalNotPass, ...remaining], {
				invalid: true,
				observations,
			});
		}
		if (mechanismName === "include") {
			const nested = await inspectExpectedSpfDomain(
				mechanism.slice("include:".length),
				remaining,
				dns,
				lookupBudget,
				visited,
			);
			observations.push(...nested.observations);
			if (nested.indeterminate || nested.invalid) {
				return expectedSpfInspection([...terminalNotPass, ...remaining], {
					indeterminate: nested.indeterminate,
					invalid: nested.invalid,
					observations,
				});
			}
			const passedByNested = subtractSpfIntervals(remaining, nested.remaining);
			remaining = nested.remaining;
			if (
				qualifier !== undefined &&
				qualifier !== "+" &&
				passedByNested.length > 0
			) {
				terminalNotPass = normalizeSpfIntervals([
					...terminalNotPass,
					...passedByNested,
				]);
			}
			if (remaining.length === 0) {
				return expectedSpfInspection(terminalNotPass, {
					observations,
					unconditionalPass:
						terminalNotPass.length === 0 &&
						nested.unconditional_pass === true,
				});
			}
			continue;
		}
		const match = await inspectExpectedSpfDnsMechanism(
			mechanism,
			currentDomain,
			remaining,
			dns,
			lookupBudget,
		);
		if (match.indeterminate || match.invalid) {
			return expectedSpfInspection([...terminalNotPass, ...remaining], {
				indeterminate: match.indeterminate,
				invalid: match.invalid,
				observations,
			});
		}
		const matched = match.matchesAll
			? remaining
			: intersectSpfIntervals(remaining, match.intervals);
		if (matched.length === 0) continue;
		if (
			match.matchesAll &&
			mechanismName === "exists" &&
			!allowUnscopedPass &&
			(qualifier === undefined || qualifier === "+")
		) {
			continue;
		}
		remaining = subtractSpfIntervals(remaining, matched);
		if (qualifier !== undefined && qualifier !== "+") {
			terminalNotPass = normalizeSpfIntervals([...terminalNotPass, ...matched]);
		}
		if (remaining.length === 0) {
			return expectedSpfInspection(terminalNotPass, {
				observations,
				unconditionalPass:
					terminalNotPass.length === 0 && match.matchesAll,
			});
		}
	}
	if (redirectTarget !== undefined && remaining.length > 0) {
		if (!consumeSpfDnsLookup(lookupBudget)) {
			return expectedSpfInspection([...terminalNotPass, ...remaining], {
				invalid: true,
				observations,
			});
		}
		const redirected = await inspectExpectedSpfDomain(
			redirectTarget,
			remaining,
			dns,
			lookupBudget,
			visited,
		);
		return expectedSpfInspection(
			[...terminalNotPass, ...redirected.remaining],
			{
				indeterminate: redirected.indeterminate,
				invalid: redirected.invalid,
				observations: [
					...observations,
					...redirected.observations,
				],
				unconditionalPass:
					terminalNotPass.length === 0 &&
					redirected.unconditional_pass === true,
			},
		);
	}
	return expectedSpfInspection([...terminalNotPass, ...remaining], {
		observations,
	});
}

async function inspectExpectedDirectSpfRanges(
	record: string,
	currentDomain: string,
	expectedRanges: readonly string[],
	dns: ProviderDnsResolver,
): Promise<SpfAuthorizationInspection> {
	const parsedRanges = expectedRanges
		.map(parseSpfIpInterval)
		.filter((range): range is SpfIpInterval => range !== undefined);
	if (
		expectedRanges.length === 0 ||
		parsedRanges.length !== expectedRanges.length
	) {
		return {
			ready: false,
			indeterminate: false,
			invalid: expectedRanges.length > 0,
			observations: [],
		};
	}
	const inspection = await inspectExpectedSpfRecord(
		record,
		normalizeDomain(currentDomain),
		parsedRanges,
		dns,
		{ used: 0, void: 0 },
		new Set([normalizeDomain(currentDomain)]),
		false,
	);
	return {
		ready: inspection.ready,
		...(inspection.unconditional_pass === undefined
			? {}
			: { unconditional_pass: inspection.unconditional_pass }),
		indeterminate: inspection.indeterminate,
		invalid: inspection.invalid,
		observations: inspection.observations,
	};
}

function mxExchange(record: string): string | undefined {
	const match = /^\d+\s+(\S+)$/.exec(record.trim());
	if (match === null) return undefined;
	const exchange = normalizeDomain(match[1]!);
	return validatedDomain(exchange);
}

async function inspectGenericMailFromMx(
	records: readonly string[],
	dns: ProviderDnsResolver,
): Promise<SpfMechanismMatch> {
	const exchanges = records.map(mxExchange);
	if (
		exchanges.length === 0 ||
		exchanges.some((exchange) => exchange === undefined)
	) {
		return { matches: false, indeterminate: false, invalid: true };
	}
	const validatedExchanges = exchanges.filter(
		(exchange): exchange is string => exchange !== undefined,
	);
	const results = await Promise.all(
		validatedExchanges.map((exchange) => inspectSpfAddresses(exchange, dns)),
	);
	if (results.some(({ matches }) => matches)) {
		return { matches: true, indeterminate: false, invalid: false };
	}
	if (results.some(({ indeterminate }) => indeterminate)) {
		return { matches: false, indeterminate: true, invalid: false };
	}
	return { matches: false, indeterminate: false, invalid: false };
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
	} else if (
		selectors.some(
			(selector) =>
				!validDkimOwnerName(selector, profile.sending_domain),
		)
	) {
		checks.push({
			id: "dns.dkim",
			status: "fail",
			message:
				"One or more provider DKIM selectors cannot form a valid DNS owner name for the sending domain.",
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
				let delegatedTargets: string[] = [];
				if (profile.kind === "ses") {
					const expectedTarget = normalizeDomain(
						`${selector}.dkim.amazonses.com`,
					);
					if (
						cname.values.length === 1 &&
						normalizeDomain(cname.values[0]!) === expectedTarget
					) {
						delegatedTargets = [expectedTarget];
					}
				} else {
					delegatedTargets = cname.values.map(normalizeDomain);
				}
				if (delegatedTargets.length > 0) {
					const delegatedResults = await Promise.all(
						delegatedTargets.map(async (target) => {
							return resolveDnsObservation(
								target,
								"TXT",
								() => dns.txt(target),
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
		identity === undefined
			? profile.mail_from_domain
			: identity.mail_from_domain;
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
			isSpfVersionOneRecord(record),
		);
		const expectedInclude =
			profile.expected_spf_include ??
			(profile.kind === "ses" ? "amazonses.com" : undefined);
		const expectedIncludePath =
			spfRecords.length === 1 && expectedInclude !== undefined
				? await inspectSpfExpectedIncludePath(
						spfRecords[0]!,
						mailFromDomain,
						expectedInclude,
						dns,
					)
				: undefined;
		if (expectedIncludePath !== undefined) {
			observations.push(...expectedIncludePath.observations);
		}
		const includeAuthorization =
			expectedInclude === undefined || expectedIncludePath?.found !== true
				? undefined
				: await inspectSpfAuthorizationTarget(
						expectedInclude,
						dns,
						new Set([mailFromDomain]),
						expectedIncludePath.lookupBudget,
					);
		if (includeAuthorization !== undefined) {
			observations.push(...includeAuthorization.observations);
		}
		const directAuthorization =
			expectedInclude === undefined && spfRecords.length === 1
				? await inspectExpectedDirectSpfRanges(
						spfRecords[0]!,
						mailFromDomain,
						profile.expected_spf_ip_ranges,
						dns,
					)
				: undefined;
		if (directAuthorization !== undefined) {
			observations.push(
				...directAuthorization.observations.filter(
					(observation) =>
						observation.name !== normalizeDomain(mailFromDomain) ||
						observation.type !== "TXT",
				),
			);
		}
		const spfReady =
			spfRecords.length === 1 &&
			(expectedInclude === undefined
				? directAuthorization?.ready === true
				: expectedIncludePath?.found === true &&
					includeAuthorization?.ready === true);
		// Invalid SPF syntax and exhausted lookup budgets are deterministic
		// policy errors, so they fail readiness; only unavailable DNS evidence
		// remains unknown.
		let spfStatus: DoctorCheckStatus;
		if (
			txt.outcome === "error" ||
			expectedIncludePath?.indeterminate === true ||
			includeAuthorization?.indeterminate === true ||
			directAuthorization?.indeterminate === true
		) {
			spfStatus = "unknown";
		} else if (spfReady) {
			spfStatus = "pass";
		} else {
			spfStatus = "fail";
		}
		let spfMessage: string;
		if (txt.outcome === "error") {
			spfMessage =
				"Custom MAIL FROM SPF could not be determined because the DNS lookup failed.";
		} else if (expectedInclude === undefined) {
			spfMessage = spfReady
				? "Custom MAIL FROM SPF has a valid authorization path."
				: "Custom MAIL FROM SPF is missing, duplicated, invalid, or has no valid authorization path.";
		} else {
			spfMessage = spfReady
				? "Custom MAIL FROM SPF and its expected include target are present."
				: "Custom MAIL FROM SPF or its expected include target is missing, duplicated, or invalid.";
		}
		checks.push({
			id: "dns.spf",
			status: spfStatus,
			message: spfMessage,
			details: {
				name: mailFromDomain,
				expected_include: expectedInclude,
				expected_ip_ranges: profile.expected_spf_ip_ranges,
			},
		});
		const expectedMx =
			profile.kind === "ses" && profile.region
				? `feedback-smtp.${profile.region}.${sesMailFromDnsSuffix(profile.region)}`
				: undefined;
		const genericMxInspection =
			expectedMx === undefined && mx.outcome === "found"
				? await inspectGenericMailFromMx(mx.values, dns)
				: undefined;
		const mxReady =
			expectedMx === undefined
				? genericMxInspection?.matches === true
				: mx.values.length === 1 &&
					mx.values[0] === `10 ${expectedMx}`;
		let mxStatus: DoctorCheckStatus;
		if (
			mx.outcome === "error" ||
			genericMxInspection?.indeterminate === true
		) {
			mxStatus = "unknown";
		} else {
			mxStatus = mxReady ? "pass" : "fail";
		}
		let mxMessage: string;
		if (mxStatus === "unknown") {
			mxMessage =
				"Custom MAIL FROM MX or exchange address readiness could not be determined because DNS evidence is unavailable.";
		} else if (mxReady) {
			mxMessage =
				expectedMx === undefined
					? "Custom MAIL FROM MX has a resolvable exchange."
					: "Custom MAIL FROM MX record is present.";
		} else {
			mxMessage =
				expectedMx === undefined
					? "Custom MAIL FROM requires an MX exchange with a usable A or AAAA address."
					: "Custom MAIL FROM requires exactly one expected MX record.";
		}
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
		if (dmarc.policy === undefined || dmarc.indeterminate) {
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
			identity === undefined
				? profile.mail_from_domain
				: identity.mail_from_domain;
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
