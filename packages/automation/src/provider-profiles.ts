import {
	GetAccountCommand,
	GetEmailIdentityCommand,
	SESv2Client,
} from "@aws-sdk/client-sesv2";
import { fromIni } from "@aws-sdk/credential-providers";
import { readFile, stat } from "node:fs/promises";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { z } from "zod";

const MAX_PROVIDER_CONFIG_BYTES = 1_048_576;
const DEFAULT_PROVIDER_TIMEOUT_MS = 10_000;

const providerIdSchema = z
	.string()
	.trim()
	.min(1)
	.max(80)
	.regex(/^[a-z][a-z0-9._-]*$/);
const domainSchema = z
	.string()
	.trim()
	.toLowerCase()
	.transform((value) => value.replace(/\.$/, ""))
	.pipe(
		z
			.string()
			.min(1)
			.max(253)
			.regex(
				/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
			),
	);
const hostnameSchema = z
	.string()
	.trim()
	.toLowerCase()
	.transform((value) => value.replace(/\.$/, ""))
	.pipe(
		z
			.string()
			.min(1)
			.max(253)
			.regex(
				/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/,
			),
	);
const spfDnsTargetSchema = z
	.string()
	.trim()
	.toLowerCase()
	.transform((value) => value.replace(/\.$/, ""))
	.pipe(
		z
			.string()
			.min(1)
			.max(253)
			.regex(
				/^(?=.{1,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/,
			),
	);
const awsSecretReferenceSchema = z
	.string()
	.trim()
	.regex(/^aws:(?:default|profile:[A-Za-z0-9+=,.@_-]{1,128})$/);
const awsRegionSchema = z
	.string()
	.trim()
	.toLowerCase()
	.min(1)
	.max(63)
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)+-[0-9]+$/);
const smtpUsernameFingerprintSchema = z
	.string()
	.trim()
	.toLowerCase()
	.regex(/^sha256:[a-f0-9]{64}$/);
const spfIpRangeSchema = z
	.string()
	.trim()
	.toLowerCase()
	.refine((value) => {
		const separator = value.lastIndexOf("/");
		const address = separator === -1 ? value : value.slice(0, separator);
		const prefix = separator === -1 ? undefined : value.slice(separator + 1);
		if (address.includes("%")) return false;
		const family = isIP(address);
		if (family !== 4 && family !== 6) return false;
		if (prefix === undefined) return true;
		if (!/^\d+$/.test(prefix)) return false;
		const prefixLength = Number(prefix);
		return prefixLength >= 0 && prefixLength <= (family === 4 ? 32 : 128);
	}, "Expected SPF sender ranges must be valid IPv4 or IPv6 CIDR values");

export const providerProfileSchema = z
	.object({
		id: providerIdSchema,
		kind: z.enum(["ses", "smtp"]),
		messenger: z.literal("email").default("email"),
		sending_domain: domainSchema,
		from_email: z.email().optional(),
		smtp_hosts: z.array(hostnameSchema).max(20).default([]),
		smtp_username_fingerprints: z
			.array(smtpUsernameFingerprintSchema)
			.max(20)
			.default([]),
		dkim_selectors: z
			.array(
				z
					.string()
					.trim()
					.min(1)
					.max(253)
					.regex(
						/^(?:[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?)(?:\.(?:[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?))*$/,
					),
			)
			.max(20)
			.default([]),
		mail_from_domain: domainSchema.optional(),
		expected_spf_include: spfDnsTargetSchema.optional(),
		expected_spf_ip_ranges: z.array(spfIpRangeSchema).max(100).default([]),
		region: awsRegionSchema.optional(),
		secret_ref: awsSecretReferenceSchema.optional(),
		webhook_source: z.string().trim().min(1).max(100).optional(),
		webhook_max_age_hours: z.number().int().min(1).max(8_760).default(168),
	})
	.strict()
	.superRefine((profile, context) => {
		for (const [field, values] of [
			["smtp_hosts", profile.smtp_hosts],
			[
				"smtp_username_fingerprints",
				profile.smtp_username_fingerprints,
			],
			["dkim_selectors", profile.dkim_selectors],
			["expected_spf_ip_ranges", profile.expected_spf_ip_ranges],
		] as const) {
			const seen = new Set<string>();
			for (const [index, value] of values.entries()) {
				if (seen.has(value)) {
					context.addIssue({
						code: "custom",
						path: [field, index],
						message: `Duplicate ${field} value: ${value}`,
					});
				}
				seen.add(value);
			}
		}
		for (const [index, selector] of profile.dkim_selectors.entries()) {
			if (
				`${selector}._domainkey.${profile.sending_domain}`.length >
				253
			) {
				context.addIssue({
					code: "custom",
					path: ["dkim_selectors", index],
					message:
						"DKIM selector and sending domain produce a DNS owner name longer than 253 characters",
				});
			}
		}
		if (
			profile.expected_spf_include !== undefined &&
			profile.expected_spf_ip_ranges.length > 0
		) {
			context.addIssue({
				code: "custom",
				path: ["expected_spf_ip_ranges"],
				message:
					"Configure either expected_spf_include or expected_spf_ip_ranges, not both",
			});
		}
		if (profile.kind === "ses") {
			if (profile.region === undefined) {
				context.addIssue({
					code: "custom",
					path: ["region"],
					message: "SES provider profiles require region",
				});
			}
			if (profile.secret_ref === undefined) {
				context.addIssue({
					code: "custom",
					path: ["secret_ref"],
					message:
						"SES provider profiles require an aws:default or aws:profile:<name> secret reference",
				});
			}
			if (profile.smtp_username_fingerprints.length === 0) {
				context.addIssue({
					code: "custom",
					path: ["smtp_username_fingerprints"],
					message:
						"SES provider profiles require at least one SHA-256 SMTP username fingerprint",
				});
			}
			if (profile.expected_spf_ip_ranges.length > 0) {
				context.addIssue({
					code: "custom",
					path: ["expected_spf_ip_ranges"],
					message:
						"SES provider profiles derive their expected SPF include and do not accept direct sender ranges",
				});
			}
		} else {
			if (profile.secret_ref !== undefined) {
				context.addIssue({
					code: "custom",
					path: ["secret_ref"],
					message: "Generic SMTP profiles do not accept AWS secret references",
				});
			}
			if (profile.smtp_hosts.length === 0) {
				context.addIssue({
					code: "custom",
					path: ["smtp_hosts"],
					message: "Generic SMTP provider profiles require an SMTP host",
				});
			}
			if (
				profile.mail_from_domain !== undefined &&
				profile.expected_spf_include === undefined &&
				profile.expected_spf_ip_ranges.length === 0
			) {
				context.addIssue({
					code: "custom",
					path: ["expected_spf_ip_ranges"],
					message:
						"Generic SMTP profiles with a direct MAIL FROM SPF policy require expected sender IP ranges",
				});
			}
		}
	});

export type ProviderProfile = z.output<typeof providerProfileSchema>;

export const providerConfigSchema = z
	.object({
		schema_version: z.literal(1),
		profiles: z.array(providerProfileSchema).max(100),
	})
	.strict()
	.superRefine((config, context) => {
		const seen = new Set<string>();
		for (const [index, profile] of config.profiles.entries()) {
			if (seen.has(profile.id)) {
				context.addIssue({
					code: "custom",
					path: ["profiles", index, "id"],
					message: `Duplicate provider profile id: ${profile.id}`,
				});
			}
			seen.add(profile.id);
		}
	});

export interface ProviderProfileLoaderOptions {
	path?: string | undefined;
	env?: Readonly<Record<string, string | undefined>> | undefined;
}

export async function loadProviderProfiles(
	options: ProviderProfileLoaderOptions = {},
): Promise<readonly ProviderProfile[]> {
	const configuredPath =
		options.path ??
		options.env?.LISTMONK_OPS_PROVIDER_CONFIG ??
		process.env.LISTMONK_OPS_PROVIDER_CONFIG;
	if (!configuredPath) {
		return [];
	}

	const absolutePath = resolve(configuredPath);
	let metadata;
	try {
		metadata = await stat(absolutePath);
	} catch {
		throw new TypeError(
			"Provider config is not accessible; check LISTMONK_OPS_PROVIDER_CONFIG",
		);
	}
	if (!metadata.isFile()) {
		throw new TypeError("Provider config must reference a regular JSON file");
	}
	if (metadata.size > MAX_PROVIDER_CONFIG_BYTES) {
		throw new RangeError(
			`Provider config exceeds ${MAX_PROVIDER_CONFIG_BYTES} bytes`,
		);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(absolutePath, "utf8"));
	} catch {
		throw new TypeError("Failed to parse provider config JSON");
	}

	return providerConfigSchema.parse(parsed).profiles;
}

export interface SesAccountSnapshot {
	production_access_enabled?: boolean | undefined;
	sending_enabled?: boolean | undefined;
	enforcement_status?: string | undefined;
	max_24_hour_send?: number | undefined;
	max_send_rate?: number | undefined;
	sent_last_24_hours?: number | undefined;
	suppressed_reasons: string[];
}

export interface SesIdentitySnapshot {
	identity_type?: string | undefined;
	verified_for_sending?: boolean | undefined;
	verification_status?: string | undefined;
	feedback_forwarding_enabled?: boolean | undefined;
	dkim_signing_enabled?: boolean | undefined;
	dkim_status?: string | undefined;
	dkim_tokens: string[];
	mail_from_domain?: string | undefined;
	mail_from_status?: string | undefined;
	mail_from_behavior?: string | undefined;
}

export interface ProviderInspector {
	inspectAccount(): Promise<SesAccountSnapshot>;
	inspectIdentity(): Promise<SesIdentitySnapshot>;
	close(): void;
}

function credentialsForReference(secretReference: string) {
	if (secretReference === "aws:default") {
		return undefined;
	}
	const profile = secretReference.slice("aws:profile:".length);
	return fromIni({ profile });
}

function commandSignal(timeoutMs: number): {
	signal: AbortSignal;
	clear: () => void;
} {
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort(
			new Error(`SES provider inspection timed out after ${timeoutMs}ms`),
		);
	}, timeoutMs);
	return {
		signal: controller.signal,
		clear: () => clearTimeout(timer),
	};
}

async function sendWithTimeout<T>(
	timeoutMs: number,
	send: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
	const timeout = commandSignal(timeoutMs);
	try {
		return await send(timeout.signal);
	} finally {
		timeout.clear();
	}
}

export function createSesProviderInspector(
	profile: ProviderProfile,
	timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
): ProviderInspector {
	if (profile.kind !== "ses" || !profile.region || !profile.secret_ref) {
		throw new TypeError("A complete SES provider profile is required");
	}
	if (
		!Number.isInteger(timeoutMs) ||
		timeoutMs < 1_000 ||
		timeoutMs > 120_000
	) {
		throw new RangeError("Provider timeout must be between 1000 and 120000ms");
	}

	const credentials = credentialsForReference(profile.secret_ref);
	const client = new SESv2Client({
		region: profile.region,
		maxAttempts: 2,
		...(credentials === undefined ? {} : { credentials }),
	});
	let accountPromise: Promise<SesAccountSnapshot> | undefined;
	let identityPromise: Promise<SesIdentitySnapshot> | undefined;

	return {
		inspectAccount() {
			if (accountPromise === undefined) {
				const pending = sendWithTimeout(timeoutMs, async (signal) => {
					const account = await client.send(new GetAccountCommand({}), {
						abortSignal: signal,
					});
					return {
						production_access_enabled: account.ProductionAccessEnabled,
						sending_enabled: account.SendingEnabled,
						enforcement_status: account.EnforcementStatus,
						max_24_hour_send: account.SendQuota?.Max24HourSend,
						max_send_rate: account.SendQuota?.MaxSendRate,
						sent_last_24_hours: account.SendQuota?.SentLast24Hours,
						suppressed_reasons: [
							...(account.SuppressionAttributes?.SuppressedReasons ?? []),
						],
					};
				});
				accountPromise = pending;
				void pending.catch(() => {
					if (accountPromise === pending) accountPromise = undefined;
				});
			}
			return accountPromise;
		},
		inspectIdentity() {
			if (identityPromise === undefined) {
				const pending = sendWithTimeout(timeoutMs, async (signal) => {
					const identity = await client.send(
						new GetEmailIdentityCommand({
							EmailIdentity: profile.sending_domain,
						}),
						{ abortSignal: signal },
					);
					return {
						identity_type: identity.IdentityType,
						verified_for_sending: identity.VerifiedForSendingStatus,
						verification_status: identity.VerificationStatus,
						feedback_forwarding_enabled: identity.FeedbackForwardingStatus,
						dkim_signing_enabled: identity.DkimAttributes?.SigningEnabled,
						dkim_status: identity.DkimAttributes?.Status,
						dkim_tokens: [...(identity.DkimAttributes?.Tokens ?? [])],
						mail_from_domain: identity.MailFromAttributes?.MailFromDomain,
						mail_from_status: identity.MailFromAttributes?.MailFromDomainStatus,
						mail_from_behavior:
							identity.MailFromAttributes?.BehaviorOnMxFailure,
					};
				});
				identityPromise = pending;
				void pending.catch(() => {
					if (identityPromise === pending) identityPromise = undefined;
				});
			}
			return identityPromise;
		},
		close() {
			client.destroy();
		},
	};
}

export function getProviderProfile(
	profiles: readonly ProviderProfile[],
	providerId: string,
): ProviderProfile {
	const profile = profiles.find(({ id }) => id === providerId);
	if (!profile) {
		throw new RangeError(`Unknown provider profile: ${providerId}`);
	}
	return profile;
}
