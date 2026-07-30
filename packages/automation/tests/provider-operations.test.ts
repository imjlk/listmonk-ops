import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	invokeDeliverabilityDnsCheckOperation,
	invokeDeliverabilityDoctorOperation,
	invokeProviderListOperation,
	invokeProviderQuotaOperation,
	invokeProviderStatusOperation,
	invokeProviderTestOperation,
	invokeProviderWebhookStatusOperation,
	inspectListmonkProviderSettings,
	inspectProviderDns,
	loadProviderProfiles,
	providerOperationCatalog,
	providerConfigSchema,
	providerProfileSchema,
	type ProviderDnsResolver,
	type ProviderInspector,
	type ProviderOperationContext,
	type ProviderProfile,
} from "../src";

const fixedNow = new Date("2026-07-29T00:00:00.000Z");
const validRsaDkimPublicKey =
	"MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCiRZP7BQUD9YLLLsAGRpKXPw/vidM72qPEBYY7HOv+NJ58tSojO2KTq3tOjWd0XVZA7c4r5k8ZnnIbUIa9fj/5Xkiu7c3mZ0aaJIjJsF1N9G7OYHV/nipUAzGJNDXY4N1MFPBHYwJMbpDRCMtSF7IejXWFm3m586oXZANtNvGw0wIDAQAB";
const validEd25519DkimPublicKey =
	"11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=";
const nonCanonicalEd25519DkimPublicKey =
	"7f///////////////////////////////////////38=";
const smallOrderEd25519DkimPublicKey =
	"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const sesSmtpUsername = "AKIA_TEST_SES_SMTP_USERNAME";
const sesSmtpUsernameFingerprint =
	"sha256:5e966714de655274201793ffcfdd043fedd09b037e00c8b8238596bbbb757593";
const profile = providerProfileSchema.parse({
	id: "marketing-primary",
	kind: "ses",
	messenger: "email",
	sending_domain: "news.example.com",
	from_email: "newsletter@news.example.com",
	region: "ap-northeast-2",
	secret_ref: "aws:profile:newsletter",
	smtp_username_fingerprints: [sesSmtpUsernameFingerprint],
	webhook_source: "ses",
	webhook_max_age_hours: 168,
});

function inspector(): ProviderInspector {
	return {
		async inspectAccount() {
			return {
				production_access_enabled: true,
				sending_enabled: true,
				enforcement_status: "HEALTHY",
				max_24_hour_send: 50_000,
				max_send_rate: 20,
				sent_last_24_hours: 10_000,
				suppressed_reasons: ["BOUNCE", "COMPLAINT"],
			};
		},
		async inspectIdentity() {
			return {
				identity_type: "DOMAIN",
				verified_for_sending: true,
				verification_status: "SUCCESS",
				feedback_forwarding_enabled: false,
				dkim_signing_enabled: true,
				dkim_status: "SUCCESS",
				dkim_tokens: ["token-a", "token-b", "token-c"],
				mail_from_domain: "bounce.news.example.com",
				mail_from_status: "SUCCESS",
				mail_from_behavior: "REJECT_MESSAGE",
			};
		},
		close() {},
	};
}

const dns: ProviderDnsResolver = {
	async txt(name) {
		if (name === "_dmarc.news.example.com") {
			return ["v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com"];
		}
		if (name === "bounce.news.example.com") {
			return ["v=spf1 include:amazonses.com ~all"];
		}
		if (name === "amazonses.com") {
			return ["v=spf1 ip4:192.0.2.0/24 -all"];
		}
		if (name.endsWith(".dkim.amazonses.com")) {
			return [`v=DKIM1; k=rsa; p=${validRsaDkimPublicKey}`];
		}
		return [];
	},
	async cname(name) {
		if (name.endsWith("._domainkey.news.example.com")) {
			return [`${name.split(".")[0]}.dkim.amazonses.com`];
		}
		return [];
	},
	async mx(name) {
		if (name === "bounce.news.example.com") {
			return [
				{
					priority: 10,
					exchange: "feedback-smtp.ap-northeast-2.amazonses.com",
				},
			];
		}
		return [];
	},
};

function context(
	overrides: Partial<ProviderOperationContext> = {},
): ProviderOperationContext {
	return {
		profiles: [profile],
		createInspector: () => inspector(),
		now: () => fixedNow,
		dns,
		client: {
			settings: {
				async get() {
					return {
						data: {
							"app.from_email": "Newsletter <newsletter@news.example.com>",
							"privacy.unsubscribe_header": true,
							"bounce.enabled": true,
							"bounce.webhooks_enabled": true,
							"bounce.ses_enabled": true,
							smtp: [
								{
									host: "email-smtp.ap-northeast-2.amazonaws.com",
									username: sesSmtpUsername,
									enabled: true,
								},
							],
						},
					} as never;
				},
			},
			bounce: {
				async list() {
					return {
						data: {
							results: [
								{
									source: "ses",
									type: "hard",
									created_at: "2026-07-28T23:00:00.000Z",
									email: "must-not-leak@example.com",
								},
							],
							total: 1,
							per_page: 1,
							page: 1,
						},
					} as never;
				},
			},
		},
		...overrides,
	};
}

describe("provider and deliverability operations", () => {
	test("normalizes SES region identifiers before deriving DNS and SMTP hosts", () => {
		const normalized = providerProfileSchema.parse({
			...profile,
			region: "AP-NORTHEAST-2",
		});
		expect(normalized.region).toBe("ap-northeast-2");
		expect(
			inspectListmonkProviderSettings(normalized, {
				smtp: [
					{
						host: "email-smtp.ap-northeast-2.amazonaws.com",
						username: sesSmtpUsername,
						enabled: true,
					},
				],
			}),
		).toMatchObject({
			smtp_configured: true,
			smtp_enabled: true,
		});
		const china = providerProfileSchema.parse({
			...profile,
			region: "CN-NORTH-1",
		});
		expect(
			inspectListmonkProviderSettings(china, {
				smtp: [
					{
						host: "email-smtp.cn-north-1.amazonaws.com.cn",
						username: sesSmtpUsername,
						enabled: true,
					},
				],
			}),
		).toMatchObject({
			smtp_configured: true,
			smtp_enabled: true,
		});
	});

	test("requires the complete enabled SMTP pool and configured credential fingerprints", () => {
		const poolProfile = providerProfileSchema.parse({
			...profile,
			smtp_hosts: [
				"email-smtp.ap-northeast-2.amazonaws.com",
				"smtp-backup.example.com",
			],
		});
		const exact = inspectListmonkProviderSettings(poolProfile, {
			smtp: [
				{
					host: "email-smtp.ap-northeast-2.amazonaws.com",
					username: sesSmtpUsername,
					enabled: true,
				},
				{
					host: "smtp-backup.example.com",
					username: sesSmtpUsername,
					enabled: true,
				},
			],
		});
		expect(exact).toMatchObject({
			enabled_smtp_hosts: [
				"email-smtp.ap-northeast-2.amazonaws.com",
				"smtp-backup.example.com",
			],
			smtp_pool_exact: true,
			smtp_credentials_bound: true,
			smtp_enabled: true,
		});
		expect(JSON.stringify(exact)).not.toContain(sesSmtpUsername);
		expect(JSON.stringify(exact)).not.toContain(
			sesSmtpUsernameFingerprint,
		);

		for (const smtp of [
			[
				{
					host: "email-smtp.ap-northeast-2.amazonaws.com",
					username: sesSmtpUsername,
					enabled: true,
				},
			],
			[
				{
					host: "email-smtp.ap-northeast-2.amazonaws.com",
					username: sesSmtpUsername,
					enabled: true,
				},
				{
					host: "smtp-unexpected.example.com",
					username: sesSmtpUsername,
					enabled: true,
				},
			],
		]) {
			expect(
				inspectListmonkProviderSettings(poolProfile, { smtp }),
			).toMatchObject({
				smtp_pool_exact: false,
				smtp_enabled: false,
				messenger_enabled: false,
			});
		}

		expect(
			inspectListmonkProviderSettings(profile, {
				smtp: [
					{
						host: "email-smtp.ap-northeast-2.amazonaws.com",
						username: "DIFFERENT_SES_SMTP_USERNAME",
						enabled: true,
					},
				],
			}),
		).toMatchObject({
			smtp_pool_exact: true,
			smtp_credentials_bound: false,
			smtp_enabled: false,
			messenger_enabled: false,
		});
	});

	test("exposes one shared typed operation family without credential values", async () => {
		expect(providerOperationCatalog.operations).toHaveLength(7);
		const output = await invokeProviderListOperation(context(), {});
		expect(output).toEqual({
			configured: true,
			profiles: [
				{
					id: "marketing-primary",
					kind: "ses",
					messenger: "email",
					sending_domain: "news.example.com",
					from_email: "newsletter@news.example.com",
					region: "ap-northeast-2",
					smtp_hosts: [],
					webhook_source: "ses",
					credential_reference_configured: true,
				},
			],
		});
		expect(JSON.stringify(output)).not.toContain("aws:profile:newsletter");
		expect(JSON.stringify(output)).not.toContain("secret_ref");
	});

	test("reports SES account, identity, quota, webhook, and DNS readiness", async () => {
		const operationContext = context();
		const status = await invokeProviderStatusOperation(operationContext, {
			provider_id: profile.id,
		});
		expect(status.health).toBe("healthy");
		expect(status.api).toMatchObject({
			supported: true,
			reachable: true,
			authenticated: true,
		});
		expect(status.listmonk).toMatchObject({
			messenger_configured: true,
			messenger_enabled: true,
			smtp_configured: true,
			smtp_enabled: true,
			unsubscribe_header_enabled: true,
			bounce_processing_enabled: true,
		});

		const testResult = await invokeProviderTestOperation(operationContext, {
			provider_id: profile.id,
		});
		expect(testResult.probe.authenticated).toBe(true);

		const quota = await invokeProviderQuotaOperation(operationContext, {
			provider_id: profile.id,
		});
		expect(quota).toMatchObject({
			max_24_hour_send: 50_000,
			sent_last_24_hours: 10_000,
			remaining_24_hours: 40_000,
			utilization_percent: 20,
		});

		const webhook = await invokeProviderWebhookStatusOperation(
			operationContext,
			{ provider_id: profile.id },
		);
		expect(webhook.freshness).toBe("fresh");
		expect(webhook.healthy).toBe(true);
		expect(JSON.stringify(webhook)).not.toContain("must-not-leak");

		const dnsResult = await invokeDeliverabilityDnsCheckOperation(
			operationContext,
			{ provider_id: profile.id },
		);
		expect(dnsResult.healthy).toBe(true);
		expect(dnsResult.checks.every(({ status }) => status === "pass")).toBe(
			true,
		);

		const doctor = await invokeDeliverabilityDoctorOperation(
			operationContext,
			{ provider_id: profile.id },
		);
		expect(doctor.ready).toBe(true);
		expect(doctor.summary.fail).toBe(0);
		expect(doctor.status.provider.credential_reference_configured).toBe(true);
	});

	test("keeps missing webhook evidence distinct from a broken configuration", async () => {
		const operationContext = context({
			client: {
				...context().client!,
				bounce: {
					async list() {
						return {
							data: { results: [], total: 0, per_page: 1, page: 1 },
						} as never;
					},
				},
			},
		});
		const webhook = await invokeProviderWebhookStatusOperation(
			operationContext,
			{ provider_id: profile.id, max_age_hours: 24 },
		);
		expect(webhook).toMatchObject({
			freshness: "unknown",
			healthy: true,
		});
		expect(webhook.checks).toContainEqual(
			expect.objectContaining({
				id: "webhook.freshness",
				status: "unknown",
			}),
		);
	});

	test("blocks doctor readiness when native bounce configuration evidence is missing", async () => {
		const operationContext = context({
			client: {
				...context().client!,
				settings: {
					async get() {
						return {
							data: {
								"app.from_email":
									"Newsletter <newsletter@news.example.com>",
								"privacy.unsubscribe_header": true,
								"bounce.enabled": true,
								"bounce.webhooks_enabled": true,
					smtp: [
						{
							host: "email-smtp.ap-northeast-2.amazonaws.com",
							username: sesSmtpUsername,
							enabled: true,
						},
								],
							},
						} as never;
					},
				},
			},
		});
		const doctor = await invokeDeliverabilityDoctorOperation(
			operationContext,
			{ provider_id: profile.id },
		);
		expect(doctor.ready).toBe(false);
		expect(doctor.checks).toContainEqual(
			expect.objectContaining({
				id: "webhook.configuration",
				status: "unknown",
			}),
		);
		expect(doctor.status.checks).toContainEqual(
			expect.objectContaining({
				id: "listmonk.bounce-provider.ses",
				status: "unknown",
			}),
		);
	});

	test("checks native Listmonk bounce switches for generic SMTP profiles", async () => {
		const nativeSettings = [
			["azure", "bounce.azure.enabled", "bounce.azure"],
			[
				"forwardemail",
				"bounce.forwardemail_enabled",
				"bounce.forwardemail",
			],
			["lettermint", "bounce.lettermint_enabled", "bounce.lettermint"],
			["postmark", "bounce.postmark_enabled", "bounce.postmark"],
			["sendgrid", "bounce.sendgrid_enabled", undefined],
		] as const;
		for (const [source, directSetting, nestedSetting] of nativeSettings) {
			const smtpProfile = providerProfileSchema.parse({
				id: `${source}-relay`,
				kind: "smtp",
				sending_domain: "mail.example.com",
				smtp_hosts: ["smtp.example.com"],
				webhook_source: source,
			});
			const baseSettings = {
				"bounce.enabled": true,
				"bounce.webhooks_enabled": true,
			};
			expect(
				inspectListmonkProviderSettings(smtpProfile, baseSettings),
			).not.toHaveProperty("provider_bounce_enabled");
			expect(
				inspectListmonkProviderSettings(smtpProfile, {
					...baseSettings,
					[directSetting]: false,
				}),
			).toMatchObject({ provider_bounce_enabled: false });
			expect(
				inspectListmonkProviderSettings(smtpProfile, {
					...baseSettings,
					[directSetting]: true,
				}),
			).toMatchObject({ provider_bounce_enabled: true });
			if (nestedSetting !== undefined) {
				expect(
					inspectListmonkProviderSettings(smtpProfile, {
						...baseSettings,
						[nestedSetting]: { enabled: false },
					}),
				).toMatchObject({ provider_bounce_enabled: false });
				expect(
					inspectListmonkProviderSettings(smtpProfile, {
						...baseSettings,
						[nestedSetting]: { enabled: true },
					}),
				).toMatchObject({ provider_bounce_enabled: true });
			}
		}
		const customProfile = providerProfileSchema.parse({
			id: "custom-relay",
			kind: "smtp",
			sending_domain: "mail.example.com",
			smtp_hosts: ["smtp.example.com"],
			webhook_source: "constructor",
		});
		expect(
			inspectListmonkProviderSettings(customProfile, {
				"bounce.enabled": true,
				"bounce.webhooks_enabled": true,
			}),
		).not.toHaveProperty("provider_bounce_enabled");

		const sendgridProfile = providerProfileSchema.parse({
			id: "sendgrid-relay",
			kind: "smtp",
			sending_domain: "mail.example.com",
			smtp_hosts: ["smtp.example.com"],
			webhook_source: "sendgrid",
		});
		const output = await invokeProviderWebhookStatusOperation(
			context({
				profiles: [sendgridProfile],
				client: {
					...context().client!,
					settings: {
						async get() {
							return {
								data: {
									"bounce.enabled": true,
									"bounce.webhooks_enabled": true,
									"bounce.sendgrid_enabled": false,
								},
							} as never;
						},
					},
				},
			}),
			{ provider_id: sendgridProfile.id },
		);
		expect(output).toMatchObject({
			provider_bounce_enabled: false,
			healthy: false,
		});
		expect(output.checks).toContainEqual(
			expect.objectContaining({
				id: "webhook.configuration",
				status: "fail",
			}),
		);

		const missingOutput = await invokeProviderWebhookStatusOperation(
			context({
				profiles: [sendgridProfile],
				client: {
					...context().client!,
					settings: {
						async get() {
							return {
								data: {
									"bounce.enabled": true,
									"bounce.webhooks_enabled": true,
								},
							} as never;
						},
					},
				},
			}),
			{ provider_id: sendgridProfile.id },
		);
		expect(missingOutput).not.toHaveProperty("provider_bounce_enabled");
		expect(missingOutput).toMatchObject({ healthy: true });
		expect(missingOutput.checks).toContainEqual(
			expect.objectContaining({
				id: "webhook.configuration",
				status: "unknown",
			}),
		);
	});

	test("keeps webhook freshness unknown when the source is shared", async () => {
		const secondary = providerProfileSchema.parse({
			...profile,
			id: "marketing-secondary",
			sending_domain: "other.example.com",
			from_email: "newsletter@other.example.com",
			secret_ref: "aws:profile:secondary",
		});
		const webhook = await invokeProviderWebhookStatusOperation(
			context({ profiles: [profile, secondary] }),
			{ provider_id: profile.id },
		);
		expect(webhook).toMatchObject({
			evidence_scope: "shared",
			freshness: "unknown",
		});
		expect(webhook).not.toHaveProperty("last_event_at");
		expect(webhook.checks).toContainEqual(
			expect.objectContaining({
				id: "webhook.freshness",
				status: "unknown",
				details: {
					shared_provider_ids: ["marketing-secondary"],
				},
			}),
		);
	});

	test("rejects Listmonk bounce error envelopes instead of reporting healthy freshness", async () => {
		const errorContext = context({
			client: {
				...context().client!,
				bounce: {
					async list() {
						return {
							error: new Error("401 unauthorized"),
							data: {
								results: [],
								total: 0,
								per_page: 0,
								page: 1,
							},
						} as never;
					},
				},
			},
		});
		await expect(
			invokeProviderWebhookStatusOperation(errorContext, {
				provider_id: profile.id,
			}),
		).rejects.toThrow("Listmonk bounce inspection failed");
		const doctor = await invokeDeliverabilityDoctorOperation(errorContext, {
			provider_id: profile.id,
		});
		expect(doctor.ready).toBe(false);
		expect(doctor.webhook.healthy).toBe(false);
		expect(doctor.checks).toContainEqual(
			expect.objectContaining({
				id: "webhook.inspection",
				status: "fail",
			}),
		);
		expect(JSON.stringify(doctor)).not.toContain("401 unauthorized");
	});

	test("rejects malformed successful Listmonk bounce payloads", async () => {
		const malformedContext = context({
			client: {
				...context().client!,
				bounce: {
					async list() {
						return { data: { total: 0 } } as never;
					},
				},
			},
		});
		await expect(
			invokeProviderWebhookStatusOperation(malformedContext, {
				provider_id: profile.id,
			}),
		).rejects.toThrow(
			"Listmonk bounce inspection returned an invalid payload",
		);
		const doctor = await invokeDeliverabilityDoctorOperation(
			malformedContext,
			{ provider_id: profile.id },
		);
		expect(doctor.ready).toBe(false);
		expect(doctor.checks).toContainEqual(
			expect.objectContaining({
				id: "webhook.inspection",
				status: "fail",
			}),
		);
	});

	test("rejects Listmonk settings error envelopes", async () => {
		const errorContext = context({
			client: {
				...context().client!,
				settings: {
					async get() {
						return {
							error: new Error("credential detail must-not-leak"),
							data: {},
						} as never;
					},
				},
			},
		});
		const status = await invokeProviderStatusOperation(errorContext, {
			provider_id: profile.id,
		});
		expect(status.checks).toContainEqual(
			expect.objectContaining({
				id: "listmonk.settings",
				status: "fail",
			}),
		);
		expect(JSON.stringify(status)).not.toContain("must-not-leak");
		const doctor = await invokeDeliverabilityDoctorOperation(errorContext, {
			provider_id: profile.id,
		});
		expect(doctor.ready).toBe(false);
		expect(JSON.stringify(doctor)).not.toContain("must-not-leak");
	});

	test("does not expose credential references through provider API failures", async () => {
		const failingInspector: ProviderInspector = {
			async inspectAccount() {
				throw new Error(
					"credential profile newsletter used AKIAABCDEFGHIJKLMNOP",
				);
			},
			async inspectIdentity() {
				throw new Error("credential profile newsletter failed");
			},
			close() {},
		};
		const output = await invokeProviderTestOperation(
			context({ createInspector: () => failingInspector }),
			{ provider_id: profile.id },
		);
		expect(output.probe.authenticated).toBe(false);
		expect(output.probe.error_message).toContain("provider inspection failed");
		expect(JSON.stringify(output)).not.toContain("newsletter");
		expect(JSON.stringify(output)).not.toContain("AKIA");
		expect(JSON.stringify(output)).not.toContain("aws:profile");
	});

	test("distinguishes SES error responses from network unreachability", async () => {
		const serviceError = Object.assign(new Error("access denied"), {
			name: "AccessDeniedException",
			$metadata: { httpStatusCode: 403 },
		});
		const deniedInspector = inspector();
		deniedInspector.inspectAccount = async () => {
			throw serviceError;
		};
		deniedInspector.inspectIdentity = async () => {
			throw serviceError;
		};
		const operationContext = context({
			createInspector: () => deniedInspector,
		});
		const status = await invokeProviderStatusOperation(operationContext, {
			provider_id: profile.id,
		});
		expect(status.api).toMatchObject({
			supported: true,
			reachable: true,
			authenticated: false,
			error_code: "AccessDeniedException",
		});
		const probe = await invokeProviderTestOperation(operationContext, {
			provider_id: profile.id,
		});
		expect(probe.probe).toMatchObject({
			supported: true,
			reachable: true,
			authenticated: false,
		});
	});

	test("preserves successful SES account evidence when identity inspection fails", async () => {
		const partialInspector = inspector();
		partialInspector.inspectIdentity = async () => {
			throw Object.assign(new Error("identity not found"), {
				name: "NotFoundException",
			});
		};
		const output = await invokeProviderStatusOperation(
			context({ createInspector: () => partialInspector }),
			{ provider_id: profile.id },
		);
		expect(output.account).toMatchObject({
			production_access_enabled: true,
			max_24_hour_send: 50_000,
		});
		expect(output).not.toHaveProperty("identity");
		expect(output.api).toMatchObject({
			supported: true,
			reachable: true,
			authenticated: false,
			error_code: "NotFoundException",
		});
		expect(output.checks).toContainEqual(
			expect.objectContaining({
				id: "provider.identity",
				status: "fail",
			}),
		);
	});

	test("sanitizes standalone quota inspection failures", async () => {
		const failingInspector = inspector();
		failingInspector.inspectAccount = async () => {
			throw new Error(
				"failed to load aws:profile:newsletter from /private/credentials",
			);
		};
		let error: unknown;
		try {
			await invokeProviderQuotaOperation(
				context({ createInspector: () => failingInspector }),
				{ provider_id: profile.id },
			);
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(Error);
		expect(error).not.toBeInstanceOf(TypeError);
		const message = error instanceof Error ? error.message : String(error);
		expect(message).toContain("SES provider inspection failed");
		expect(message).not.toContain("newsletter");
		expect(message).not.toContain("/private");
	});

	test("treats SES sandbox access as not ready", async () => {
		const sandboxInspector = inspector();
		sandboxInspector.inspectAccount = async () => ({
			...(await inspector().inspectAccount()),
			production_access_enabled: false,
		});
		const output = await invokeDeliverabilityDoctorOperation(
			context({ createInspector: () => sandboxInspector }),
			{ provider_id: profile.id },
		);
		expect(output.ready).toBe(false);
		expect(output.checks).toContainEqual(
			expect.objectContaining({
				id: "provider.production-access",
				status: "fail",
			}),
		);
	});

	test("treats an exhausted finite SES daily quota as not ready", async () => {
		const exhaustedInspector = inspector();
		exhaustedInspector.inspectAccount = async () => ({
			...(await inspector().inspectAccount()),
			max_24_hour_send: 10_000,
			sent_last_24_hours: 10_000,
		});
		const output = await invokeDeliverabilityDoctorOperation(
			context({ createInspector: () => exhaustedInspector }),
			{ provider_id: profile.id },
		);
		expect(output.ready).toBe(false);
		expect(output.quota.remaining_24_hours).toBe(0);
		expect(output.checks).toContainEqual(
			expect.objectContaining({
				id: "provider.quota",
				status: "fail",
			}),
		);
	});

	test("requires the built-in email messenger and real From evidence", async () => {
		expect(
			providerProfileSchema.safeParse({
				...profile,
				messenger: "marketing",
			}).success,
		).toBe(false);
		const missing = inspectListmonkProviderSettings(
			profile,
			{
				smtp: [
					{
						host: "email-smtp.us-east-1.amazonaws.com",
						enabled: true,
					},
				],
			},
		);
		expect(missing).toMatchObject({
			messenger_configured: false,
			messenger_enabled: false,
		});
		expect(missing).not.toHaveProperty("from_domain");

		const configured = inspectListmonkProviderSettings(
			profile,
			{
				"app.from_email": "not-an-email",
				smtp: [
						{
							host: "email-smtp.ap-northeast-2.amazonaws.com",
							username: sesSmtpUsername,
							enabled: true,
						},
				],
			},
		);
		expect(configured).toMatchObject({
			messenger_configured: true,
			messenger_enabled: true,
		});
		expect(configured).not.toHaveProperty("from_domain");

		for (const malformedFrom of [
			"@news.example.com",
			"invalid address @news.example.com",
			"Newsletter <newsletter@news.example.com",
		]) {
			const malformed = inspectListmonkProviderSettings(profile, {
				"app.from_email": malformedFrom,
			});
			expect(malformed.from_email).toBe(malformedFrom);
			expect(malformed).not.toHaveProperty("from_domain");
		}
		expect(
			inspectListmonkProviderSettings(profile, {
				"app.from_email": "<newsletter@news.example.com>",
			}),
		).toMatchObject({
			from_domain: "news.example.com",
		});

		const malformedEnabled = inspectListmonkProviderSettings(
			profile,
			{
				smtp: [
					{
						host: "email-smtp.ap-northeast-2.amazonaws.com",
					},
				],
			},
		);
			expect(malformedEnabled).toMatchObject({
				messenger_configured: false,
				messenger_enabled: false,
			});

		const clientWithoutFrom = {
			...context().client!,
			settings: {
				async get() {
					return {
						data: {
							"privacy.unsubscribe_header": true,
							"bounce.enabled": true,
							"bounce.webhooks_enabled": true,
							"bounce.ses_enabled": true,
							smtp: [
								{
									host: "email-smtp.ap-northeast-2.amazonaws.com",
									enabled: true,
								},
							],
						},
					} as never;
				},
			},
		};
		const status = await invokeProviderStatusOperation(
			context({ client: clientWithoutFrom }),
			{ provider_id: profile.id },
		);
		expect(status.checks).toContainEqual(
			expect.objectContaining({
				id: "listmonk.from-alignment",
				status: "unknown",
			}),
		);
		const doctor = await invokeDeliverabilityDoctorOperation(
			context({ client: clientWithoutFrom }),
			{ provider_id: profile.id },
		);
		expect(doctor.ready).toBe(false);
	});

	test("rejects provider bindings that share a messenger and SMTP endpoint", async () => {
		const secondary = providerProfileSchema.parse({
			...profile,
			id: "marketing-secondary",
			sending_domain: "other.example.com",
			from_email: "newsletter@other.example.com",
			secret_ref: "aws:profile:secondary",
		});
		const status = await invokeProviderStatusOperation(
			context({ profiles: [profile, secondary] }),
			{ provider_id: profile.id },
		);
		expect(status.listmonk).toMatchObject({
			messenger_binding_ambiguous: true,
			messenger_configured: false,
			messenger_enabled: false,
		});
		expect(status.checks).toContainEqual(
			expect.objectContaining({
				id: "listmonk.messenger",
				status: "fail",
				message: expect.stringContaining(
					"consolidate that pool into one provider profile",
				),
			}),
		);
	});

	test("rejects provider bindings that share a messenger across distinct endpoints", async () => {
		const secondary = providerProfileSchema.parse({
			...profile,
			id: "marketing-secondary",
			sending_domain: "other.example.com",
			from_email: "newsletter@other.example.com",
			region: "us-east-1",
			secret_ref: "aws:profile:secondary",
		});
		const status = await invokeProviderStatusOperation(
			context({ profiles: [profile, secondary] }),
			{ provider_id: profile.id },
		);
		expect(status.listmonk).toMatchObject({
			messenger_binding_ambiguous: true,
			messenger_configured: false,
			messenger_enabled: false,
		});
		expect(status.checks).toContainEqual(
			expect.objectContaining({
				id: "listmonk.messenger",
				message: expect.stringContaining(
					"consolidate that pool into one provider profile",
				),
			}),
		);
	});

	test("rejects custom HTTP messengers as SMTP provider bindings", () => {
		for (const messenger of ["marketing", "marketing-a"]) {
			expect(
				providerProfileSchema.safeParse({
					...profile,
					messenger,
				}).success,
			).toBe(false);
		}
	});

	test("returns an invalid empty Listmonk From value as a diagnostic", async () => {
		const emptyFromClient = {
			...context().client!,
			settings: {
				async get() {
					const settings = await context().client!.settings.get();
					return {
						...settings,
						data: {
							...(settings.data as Readonly<Record<string, unknown>>),
							"app.from_email": "",
						},
					} as never;
				},
			},
		};
		const output = await invokeProviderStatusOperation(
			context({ client: emptyFromClient }),
			{ provider_id: profile.id },
		);
		expect(output.listmonk?.from_email).toBe("");
		expect(output.checks).toContainEqual(
			expect.objectContaining({
				id: "listmonk.from-alignment",
				status: "fail",
			}),
		);
	});

	test("does not accept future webhook timestamps as freshness evidence", async () => {
		const operationContext = context({
			client: {
				...context().client!,
				bounce: {
					async list() {
						return {
							data: {
								results: [
									{
										source: "ses",
										type: "hard",
										created_at: "2026-07-29T01:00:00.000Z",
									},
								],
								total: 1,
								per_page: 1,
								page: 1,
							},
						} as never;
					},
				},
			},
		});
		const output = await invokeProviderWebhookStatusOperation(
			operationContext,
			{ provider_id: profile.id },
		);
		expect(output.freshness).toBe("unknown");
		expect(output.checks).toContainEqual(
			expect.objectContaining({
				id: "webhook.freshness",
				status: "unknown",
			}),
		);
	});

	test("omits malformed webhook timestamps from structured output", async () => {
		const operationContext = context({
			client: {
				...context().client!,
				bounce: {
					async list() {
						return {
							data: {
								results: [
									{
										source: "ses",
										type: "hard",
										created_at: "not-a-date",
									},
								],
								total: 1,
								per_page: 1,
								page: 1,
							},
						} as never;
					},
				},
			},
		});
		const output = await invokeProviderWebhookStatusOperation(
			operationContext,
			{ provider_id: profile.id },
		);
		expect(output.freshness).toBe("unknown");
		expect(output).not.toHaveProperty("last_event_at");
	});

	test("supports inherited DMARC, direct DKIM TXT, and relaxed sibling alignment", async () => {
		const inheritedDns: ProviderDnsResolver = {
			async txt(name) {
				if (name === "_dmarc.example.com") {
					return ["v=DMARC1; p=quarantine"];
				}
				if (name.endsWith("._domainkey.news.example.com")) {
					return [
						`v=DKIM1; k=rsa; p=${validRsaDkimPublicKey}`,
					];
				}
				if (name === "bounce.example.com") {
					return ["v=spf1 include:amazonses.com ~all"];
				}
				return [];
			},
			async cname() {
				return [];
			},
			async mx(name) {
				return name === "bounce.example.com"
					? [
							{
								priority: 10,
								exchange:
									"feedback-smtp.ap-northeast-2.amazonses.com",
							},
						]
					: [];
			},
		};
		const siblingInspector = inspector();
		siblingInspector.inspectIdentity = async () => ({
			...(await inspector().inspectIdentity()),
			mail_from_domain: "bounce.example.com",
		});
		const output = await invokeDeliverabilityDnsCheckOperation(
			context({
				dns: inheritedDns,
				createInspector: () => siblingInspector,
			}),
			{ provider_id: profile.id },
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({ id: "dns.dmarc", status: "pass" }),
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({ id: "dns.dkim", status: "pass" }),
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({
				id: "dns.spf-alignment",
				status: "pass",
			}),
		);
	});

	test("accepts a direct DKIM key with the default omitted version", async () => {
		const defaultVersionDkimDns: ProviderDnsResolver = {
			...dns,
			async txt(name) {
				if (name.endsWith("._domainkey.news.example.com")) {
					return [`k=rsa; p=${validRsaDkimPublicKey}`];
				}
				return dns.txt(name);
			},
			async cname() {
				return [];
			},
		};
		const output = await invokeDeliverabilityDnsCheckOperation(
			context({ dns: defaultVersionDkimDns }),
			{ provider_id: profile.id },
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({ id: "dns.dkim", status: "pass" }),
		);
	});

	test("rejects malformed DMARC and DKIM tag-list segments", async () => {
		for (const malformedSegment of ["broken", "bad key=value"]) {
			const malformedTagsDns: ProviderDnsResolver = {
				...dns,
				async txt(name) {
					if (name === "_dmarc.news.example.com") {
						return [
							`v=DMARC1; p=quarantine; ${malformedSegment}`,
						];
					}
					if (name.endsWith("._domainkey.news.example.com")) {
						return [
							`v=DKIM1; p=${validRsaDkimPublicKey}; ${malformedSegment}`,
						];
					}
					return dns.txt(name);
				},
				async cname() {
					return [];
				},
			};
			const output = await invokeDeliverabilityDnsCheckOperation(
				context({ dns: malformedTagsDns }),
				{ provider_id: profile.id },
			);
			expect(output.checks).toContainEqual(
				expect.objectContaining({ id: "dns.dmarc", status: "fail" }),
			);
			expect(output.checks).toContainEqual(
				expect.objectContaining({ id: "dns.dkim", status: "fail" }),
			);
		}
	});

	test("requires a direct DKIM key to permit the email service", async () => {
		for (const [service, status] of [
			["sms", "fail"],
			["sms:email", "pass"],
			["*", "pass"],
		] as const) {
			const serviceDns: ProviderDnsResolver = {
				...dns,
				async txt(name) {
					if (name.endsWith("._domainkey.news.example.com")) {
						return [
							`v=DKIM1; s=${service}; p=${validRsaDkimPublicKey}`,
						];
					}
					return dns.txt(name);
				},
				async cname() {
					return [];
				},
			};
			const output = await invokeDeliverabilityDnsCheckOperation(
				context({ dns: serviceDns }),
				{ provider_id: profile.id },
			);
			expect(output.checks).toContainEqual(
				expect.objectContaining({ id: "dns.dkim", status }),
			);
		}
	});

	test("requires a direct DKIM key to permit SHA-256 signatures", async () => {
		for (const [hashes, status] of [
			["sha1", "fail"],
			["sha1:sha256", "pass"],
			["sha256", "pass"],
		] as const) {
			const hashDns: ProviderDnsResolver = {
				...dns,
				async txt(name) {
					if (name.endsWith("._domainkey.news.example.com")) {
						return [
							`v=DKIM1; h=${hashes}; p=${validRsaDkimPublicKey}`,
						];
					}
					return dns.txt(name);
				},
				async cname() {
					return [];
				},
			};
			const output = await invokeDeliverabilityDnsCheckOperation(
				context({ dns: hashDns }),
				{ provider_id: profile.id },
			);
			expect(output.checks).toContainEqual(
				expect.objectContaining({ id: "dns.dkim", status }),
			);
		}
	});

	test("requires a present DKIM version tag to be first", async () => {
		for (const [record, status] of [
			[`p=${validRsaDkimPublicKey}; v=DKIM1`, "fail"],
			[`v=DKIM1; p=${validRsaDkimPublicKey}`, "pass"],
			[`p=${validRsaDkimPublicKey}`, "pass"],
		] as const) {
			const versionDns: ProviderDnsResolver = {
				...dns,
				async txt(name) {
					if (name.endsWith("._domainkey.news.example.com")) {
						return [record];
					}
					return dns.txt(name);
				},
				async cname() {
					return [];
				},
			};
			const output = await invokeDeliverabilityDnsCheckOperation(
				context({ dns: versionDns }),
				{ provider_id: profile.id },
			);
			expect(output.checks).toContainEqual(
				expect.objectContaining({ id: "dns.dkim", status }),
			);
		}
	});

	test("validates the encoded Ed25519 DKIM curve point", async () => {
		for (const [publicKey, status] of [
			[validEd25519DkimPublicKey, "pass"],
			[validEd25519DkimPublicKey.replace(/=+$/, ""), "pass"],
			[nonCanonicalEd25519DkimPublicKey, "fail"],
			[smallOrderEd25519DkimPublicKey, "fail"],
		] as const) {
			const ed25519Dns: ProviderDnsResolver = {
				...dns,
				async txt(name) {
					if (name.endsWith("._domainkey.news.example.com")) {
						return [`v=DKIM1; k=ed25519; p=${publicKey}`];
					}
					return dns.txt(name);
				},
				async cname() {
					return [];
				},
			};
			const output = await invokeDeliverabilityDnsCheckOperation(
				context({ dns: ed25519Dns }),
				{ provider_id: profile.id },
			);
			expect(output.checks).toContainEqual(
				expect.objectContaining({ id: "dns.dkim", status }),
			);
		}
	});

	test("requires an exact SES DKIM delegation target", async () => {
		const wrongSesDkimDns: ProviderDnsResolver = {
			...dns,
			async cname(name) {
				return name.endsWith("._domainkey.news.example.com")
					? ["wrong-token.dkim.amazonses.com"]
					: [];
			},
			async txt(name) {
				if (name.endsWith("._domainkey.news.example.com")) return [];
				return dns.txt(name);
			},
		};
		const output = await invokeDeliverabilityDnsCheckOperation(
			context({ dns: wrongSesDkimDns }),
			{ provider_id: profile.id },
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({ id: "dns.dkim", status: "fail" }),
		);
	});

	test("requires the exact SES DKIM delegation target to publish a key", async () => {
		const danglingSesDkimDns: ProviderDnsResolver = {
			...dns,
			async txt(name) {
				if (name.endsWith(".dkim.amazonses.com")) return [];
				return dns.txt(name);
			},
		};
		const output = await invokeDeliverabilityDnsCheckOperation(
			context({ dns: danglingSesDkimDns }),
			{ provider_id: profile.id },
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({ id: "dns.dkim", status: "fail" }),
		);
	});

	test("keeps an exact DMARC policy authoritative across ancestor failures", async () => {
		const exactDmarcDns: ProviderDnsResolver = {
			...dns,
			async txt(name) {
				if (name === "_dmarc.news.example.com") {
					return ["v=DMARC1; p=quarantine"];
				}
				if (name.startsWith("_dmarc.")) {
					throw new Error("ancestor resolver timeout");
				}
				return dns.txt(name);
			},
		};
		const output = await invokeDeliverabilityDnsCheckOperation(
			context({ dns: exactDmarcDns }),
			{ provider_id: profile.id },
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({ id: "dns.dmarc", status: "pass" }),
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({
				id: "dns.spf-alignment",
				status: "unknown",
			}),
		);
	});

	test("uses the observed Listmonk From domain for aggregate DNS readiness", async () => {
		const broadProfile = providerProfileSchema.parse({
			...profile,
			id: "broad-domain",
			sending_domain: "example.com",
			from_email: "sender@news.example.com",
		});
		const observedQueries: string[] = [];
		const observedDns: ProviderDnsResolver = {
			async txt(name) {
				observedQueries.push(name);
				if (name === "_dmarc.other.example.com") {
					return ["v=DMARC1; p=quarantine; aspf=s"];
				}
				if (name === "bounce.news.example.com") {
					return ["v=spf1 include:amazonses.com ~all"];
				}
				return [];
			},
			cname: dns.cname,
			mx: dns.mx,
		};
		const observedClient = {
			...context().client!,
			settings: {
				async get() {
					return {
						data: {
							"app.from_email": "Sender <sender@other.example.com>",
							"privacy.unsubscribe_header": true,
							"bounce.enabled": true,
							"bounce.webhooks_enabled": true,
							"bounce.ses_enabled": true,
							smtp: [
								{
									host: "email-smtp.ap-northeast-2.amazonaws.com",
									enabled: true,
								},
							],
						},
					} as never;
				},
			},
		};
		const output = await invokeDeliverabilityDoctorOperation(
			context({
				profiles: [broadProfile],
				client: observedClient,
				dns: observedDns,
			}),
			{ provider_id: broadProfile.id },
		);
		expect(output.dns.from_domain).toBe("other.example.com");
		expect(observedQueries[0]).toBe("_dmarc.other.example.com");
	});

	test("honors strict DMARC SPF alignment", async () => {
		const strictDns: ProviderDnsResolver = {
			...dns,
			async txt(name) {
				if (name === "_dmarc.news.example.com") {
					return ["v=DMARC1; p=quarantine; aspf=s"];
				}
				return dns.txt(name);
			},
		};
		const output = await invokeDeliverabilityDnsCheckOperation(
			context({ dns: strictDns }),
			{ provider_id: profile.id },
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({
				id: "dns.spf-alignment",
				status: "fail",
			}),
		);
	});

	test("rejects malformed or incomplete DMARC policy records", async () => {
		for (const policyRecord of [
			"v=DMARC1garbage; p=reject",
			"v=DMARC1",
			"v=DMARC1; p=invalid",
			"v=DMARC1; p=reject; aspf=invalid",
			"v=DMARC1; p=reject; p=none",
		]) {
			const malformedDmarcDns: ProviderDnsResolver = {
				...dns,
				async txt(name) {
					if (name === "_dmarc.news.example.com") {
						return [policyRecord];
					}
					return dns.txt(name);
				},
			};
			const output = await invokeDeliverabilityDnsCheckOperation(
				context({ dns: malformedDmarcDns }),
				{ provider_id: profile.id },
			);
			expect(output.checks).toContainEqual(
				expect.objectContaining({ id: "dns.dmarc", status: "fail" }),
			);
		}
	});

	test("accepts DMARC policy tags in any order after the version", async () => {
		const reorderedDmarcDns: ProviderDnsResolver = {
			...dns,
			async txt(name) {
				if (name === "_dmarc.news.example.com") {
					return [
						"v=DMARC1; rua=mailto:dmarc@example.com; p=reject",
					];
				}
				return dns.txt(name);
			},
		};
		const output = await invokeDeliverabilityDnsCheckOperation(
			context({ dns: reorderedDmarcDns }),
			{ provider_id: profile.id },
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({ id: "dns.dmarc", status: "pass" }),
		);
	});

	test("accepts optional whitespace around the DMARC version separator", async () => {
		const whitespaceDns: ProviderDnsResolver = {
			...dns,
			async txt(name) {
				if (name === "_dmarc.news.example.com") {
					return ["v = DMARC1; p = reject"];
				}
				return dns.txt(name);
			},
		};
		const output = await invokeDeliverabilityDnsCheckOperation(
			context({ dns: whitespaceDns }),
			{ provider_id: profile.id },
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({ id: "dns.dmarc", status: "pass" }),
		);
	});

	test("rejects direct DKIM records with duplicate tags", async () => {
		const duplicateDkimDns: ProviderDnsResolver = {
			...dns,
			async txt(name) {
				if (name.endsWith("._domainkey.news.example.com")) {
					return [
						`v=DKIM1; p=${validRsaDkimPublicKey}; p=${validRsaDkimPublicKey}`,
					];
				}
				return dns.txt(name);
			},
			async cname() {
				return [];
			},
		};
		const output = await invokeDeliverabilityDnsCheckOperation(
			context({ dns: duplicateDkimDns }),
			{ provider_id: profile.id },
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({ id: "dns.dkim", status: "fail" }),
		);
	});

	test("rejects multiple direct DKIM key records for one selector", async () => {
		const duplicateKeyDns: ProviderDnsResolver = {
			...dns,
			async txt(name) {
				if (name.endsWith("._domainkey.news.example.com")) {
					return [
						`k=rsa; p=${validRsaDkimPublicKey}`,
						`k=rsa; p=${validRsaDkimPublicKey}`,
					];
				}
				return dns.txt(name);
			},
			async cname() {
				return [];
			},
		};
		const output = await invokeDeliverabilityDnsCheckOperation(
			context({ dns: duplicateKeyDns }),
			{ provider_id: profile.id },
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({ id: "dns.dkim", status: "fail" }),
		);
	});

	test("rejects malformed direct DKIM public-key data", async () => {
		const malformedKeyDns: ProviderDnsResolver = {
			...dns,
			async txt(name) {
				if (name.endsWith("._domainkey.news.example.com")) {
					return ["v=DKIM1; p=not-a-key"];
				}
				return dns.txt(name);
			},
			async cname() {
				return [];
			},
		};
		const output = await invokeDeliverabilityDnsCheckOperation(
			context({ dns: malformedKeyDns }),
			{ provider_id: profile.id },
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({ id: "dns.dkim", status: "fail" }),
		);
	});

	test("does not accept a direct DKIM key alongside an invalid CNAME", async () => {
		const conflictingDkimDns: ProviderDnsResolver = {
			...dns,
			async txt(name) {
				if (name.endsWith("._domainkey.news.example.com")) {
					return [`v=DKIM1; p=${validRsaDkimPublicKey}`];
				}
				return dns.txt(name);
			},
			async cname(name) {
				if (name.endsWith("._domainkey.news.example.com")) {
					return ["unexpected.dkim.example.net"];
				}
				return dns.cname(name);
			},
		};
		const output = await invokeDeliverabilityDnsCheckOperation(
			context({ dns: conflictingDkimDns }),
			{ provider_id: profile.id },
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({ id: "dns.dkim", status: "fail" }),
		);
	});

	test("rejects valid and malformed DMARC candidates published together", async () => {
		const duplicateCandidateDns: ProviderDnsResolver = {
			...dns,
			async txt(name) {
				if (name === "_dmarc.news.example.com") {
					return ["v=DMARC1; p=reject", "v=DMARC1"];
				}
				return dns.txt(name);
			},
		};
		const output = await invokeDeliverabilityDnsCheckOperation(
			context({ dns: duplicateCandidateDns }),
			{ provider_id: profile.id },
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({ id: "dns.dmarc", status: "fail" }),
		);
	});

	test("continues past the default psd=u DMARC record", async () => {
		const nestedDomain = "a.b.example.com";
		const nestedProfile = providerProfileSchema.parse({
			...profile,
			id: "nested-domain",
			sending_domain: nestedDomain,
			from_email: `newsletter@${nestedDomain}`,
		});
		const nestedDns: ProviderDnsResolver = {
			async txt(name) {
				if (name === "_dmarc.b.example.com") {
					return ["v=DMARC1; p=reject"];
				}
				if (name === "_dmarc.example.com") {
					return ["v=DMARC1; p=none"];
				}
				if (name === "bounce.news.example.com") {
					return ["v=spf1 include:amazonses.com ~all"];
				}
				return [];
			},
			async cname(name) {
				return name.endsWith(`._domainkey.${nestedDomain}`)
					? [`${name.split(".")[0]}.dkim.amazonses.com`]
					: [];
			},
			mx: dns.mx,
		};
		const output = await inspectProviderDns(
			nestedProfile,
			context({ profiles: [nestedProfile], dns: nestedDns }),
			await inspector().inspectIdentity(),
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({
				id: "dns.dmarc",
				status: "pass",
				details: expect.objectContaining({
					organizational_domain: "example.com",
				}),
			}),
		);
	});

	test("stops at an explicit psd=n DMARC organizational boundary", async () => {
		const nestedDomain = "a.b.example.com";
		const nestedProfile = providerProfileSchema.parse({
			...profile,
			id: "explicit-organizational-domain",
			sending_domain: nestedDomain,
			from_email: `newsletter@${nestedDomain}`,
		});
		const nestedDns: ProviderDnsResolver = {
			async txt(name) {
				if (name === "_dmarc.b.example.com") {
					return ["v=DMARC1; p=reject; psd=n"];
				}
				if (name === "_dmarc.example.com") {
					return ["v=DMARC1; p=none"];
				}
				if (name === "bounce.news.example.com") {
					return ["v=spf1 include:amazonses.com ~all"];
				}
				return [];
			},
			async cname(name) {
				return name.endsWith(`._domainkey.${nestedDomain}`)
					? [`${name.split(".")[0]}.dkim.amazonses.com`]
					: [];
			},
			mx: dns.mx,
		};
		const output = await inspectProviderDns(
			nestedProfile,
			context({ profiles: [nestedProfile], dns: nestedDns }),
			await inspector().inspectIdentity(),
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({
				id: "dns.dmarc",
				status: "pass",
				details: expect.objectContaining({
					organizational_domain: "b.example.com",
				}),
			}),
		);
	});

	test("stops a DMARC tree walk at psd=y before higher records", async () => {
		const nestedDomain = "a.giant.bank.example";
		const nestedProfile = providerProfileSchema.parse({
			...profile,
			id: "public-suffix-boundary",
			sending_domain: nestedDomain,
			from_email: `newsletter@${nestedDomain}`,
		});
		const nestedDns: ProviderDnsResolver = {
			async txt(name) {
				if (name === "_dmarc.bank.example") {
					return ["v=DMARC1; p=reject; psd=y"];
				}
				if (name === "_dmarc.example") {
					return ["v=DMARC1; p=none"];
				}
				if (name === "bounce.news.example.com") {
					return ["v=spf1 include:amazonses.com ~all"];
				}
				return [];
			},
			async cname(name) {
				return name.endsWith(`._domainkey.${nestedDomain}`)
					? [`${name.split(".")[0]}.dkim.amazonses.com`]
					: [];
			},
			mx: dns.mx,
		};
		const output = await inspectProviderDns(
			nestedProfile,
			context({ profiles: [nestedProfile], dns: nestedDns }),
			await inspector().inspectIdentity(),
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({
				id: "dns.dmarc",
				status: "pass",
				message: expect.stringContaining("bank.example"),
				details: expect.objectContaining({
					organizational_domain: "giant.bank.example",
				}),
			}),
		);
	});

	test("blocks strict DKIM alignment across parent and child domains", async () => {
		const parentProfile = providerProfileSchema.parse({
			...profile,
			id: "parent-identity",
			sending_domain: "example.com",
			from_email: "sender@news.example.com",
		});
		const parentIdentity = {
			...(await inspector().inspectIdentity()),
			dkim_tokens: ["token-a"],
			mail_from_domain: undefined,
		};
		const strictDkimDns: ProviderDnsResolver = {
			async txt(name) {
				if (name === "_dmarc.news.example.com") {
					return ["v=DMARC1; p=reject; adkim=s"];
				}
				if (name === "token-a.dkim.amazonses.com") {
					return [`v=DKIM1; p=${validRsaDkimPublicKey}`];
				}
				return [];
			},
			async cname(name) {
				return name === "token-a._domainkey.example.com"
					? ["token-a.dkim.amazonses.com"]
					: [];
			},
			async mx() {
				return [];
			},
		};
		const output = await inspectProviderDns(
			parentProfile,
			context({ profiles: [parentProfile], dns: strictDkimDns }),
			parentIdentity,
			"news.example.com",
		);
		expect(output.healthy).toBe(false);
		expect(output.checks).toContainEqual(
			expect.objectContaining({ id: "dns.dkim", status: "pass" }),
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({
				id: "dns.dkim-alignment",
				status: "fail",
			}),
		);
	});

	test("honors SES identity evidence that no custom MAIL FROM is configured", async () => {
		const queriedNames: string[] = [];
		const noMailFromIdentity = {
			...(await inspector().inspectIdentity()),
			mail_from_domain: undefined,
			mail_from_status: undefined,
		};
		const noMailFromDns: ProviderDnsResolver = {
			...dns,
			async txt(name) {
				queriedNames.push(name);
				return dns.txt(name);
			},
			async mx(name) {
				queriedNames.push(name);
				return dns.mx(name);
			},
		};
		const output = await inspectProviderDns(
			profile,
			context({ dns: noMailFromDns }),
			noMailFromIdentity,
		);
		expect(output).not.toHaveProperty("mail_from_domain");
		expect(output.checks).toContainEqual(
			expect.objectContaining({
				id: "dns.mail-from",
				status: "warn",
			}),
		);
		expect(output.checks.some(({ id }) => id === "dns.spf")).toBe(false);
		expect(queriedNames).not.toContain("bounce.news.example.com");
	});

	test("uses the RFC 9989 eight-query shortcut for deep DMARC trees", async () => {
		const domain = "a.b.c.d.e.f.g.h.i.j.mail.example.com";
		const deepProfile = providerProfileSchema.parse({
			...profile,
			id: "deep-domain",
			sending_domain: domain,
			from_email: `newsletter@${domain}`,
		});
		const dmarcQueries: string[] = [];
		const deepDns: ProviderDnsResolver = {
			async txt(name) {
				if (name.startsWith("_dmarc.")) {
					dmarcQueries.push(name);
					return name === "_dmarc.example.com"
						? ["v=DMARC1; p=quarantine"]
						: [];
				}
				return dns.txt(name);
			},
			cname: dns.cname,
			mx: dns.mx,
		};
		await invokeDeliverabilityDnsCheckOperation(
			context({
				profiles: [deepProfile],
				dns: deepDns,
			}),
			{ provider_id: deepProfile.id },
		);
		expect(dmarcQueries.slice(0, 8)).toEqual([
			`_dmarc.${domain}`,
			"_dmarc.g.h.i.j.mail.example.com",
			"_dmarc.h.i.j.mail.example.com",
			"_dmarc.i.j.mail.example.com",
			"_dmarc.j.mail.example.com",
			"_dmarc.mail.example.com",
			"_dmarc.example.com",
			"_dmarc.com",
		]);
	});

	test("rejects an empty From-domain override before querying DNS", async () => {
		const queries: string[] = [];
		const trackingDns: ProviderDnsResolver = {
			async txt(name) {
				queries.push(name);
				return dns.txt(name);
			},
			cname: dns.cname,
			mx: dns.mx,
		};
		const output = await inspectProviderDns(
			profile,
			context({ dns: trackingDns }),
			await inspector().inspectIdentity(),
			"",
		);
		expect(output.from_domain).toBe("news.example.com");
		expect(queries).not.toContain("_dmarc.");
	});

	test("reports transient DNS failures as unknown", async () => {
		const failingDns: ProviderDnsResolver = {
			async txt() {
				throw new Error("resolver timeout");
			},
			async cname() {
				throw new Error("resolver timeout");
			},
			async mx() {
				throw new Error("resolver timeout");
			},
		};
		const output = await invokeDeliverabilityDnsCheckOperation(
			context({ dns: failingDns }),
			{ provider_id: profile.id },
		);
		for (const id of [
			"dns.dmarc",
			"dns.dkim",
			"dns.dkim-alignment",
			"dns.spf",
			"dns.mail-from-mx",
			"dns.spf-alignment",
		]) {
			expect(output.checks).toContainEqual(
				expect.objectContaining({ id, status: "unknown" }),
			);
		}
		expect(output.healthy).toBe(false);
	});

	test("keeps SPF alignment unknown when nearer DMARC evidence fails", async () => {
		const indeterminateDmarcDns: ProviderDnsResolver = {
			...dns,
			async txt(name) {
				if (name === "_dmarc.news.example.com") {
					throw new Error("transient DNS failure");
				}
				if (name === "_dmarc.example.com") {
					return ["v=DMARC1; p=reject; aspf=s"];
				}
				return dns.txt(name);
			},
		};
		const output = await invokeDeliverabilityDnsCheckOperation(
			context({ dns: indeterminateDmarcDns }),
			{ provider_id: profile.id },
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({
				id: "dns.spf-alignment",
				status: "unknown",
			}),
		);
		expect(output.healthy).toBe(false);
	});

	test("bounds the complete DNS inspection when a resolver hangs", async () => {
		const hangingDns: ProviderDnsResolver = {
			async txt() {
				return await new Promise<string[]>(() => {});
			},
			async cname() {
				return await new Promise<string[]>(() => {});
			},
			async mx() {
				return await new Promise<
					Array<{ exchange: string; priority: number }>
				>(() => {});
			},
		};
		const startedAt = Date.now();
		const output = await invokeDeliverabilityDnsCheckOperation(
			context({
				dns: hangingDns,
				dnsInspectionTimeoutMs: 20,
			}),
			{ provider_id: profile.id },
		);
		expect(Date.now() - startedAt).toBeLessThan(1_000);
		expect(output.healthy).toBe(false);
		expect(output.checks).toContainEqual(
			expect.objectContaining({ id: "dns.dmarc", status: "unknown" }),
		);
	});

	test("requires a positively qualified exact SPF include mechanism", async () => {
		for (const spfRecord of [
			"v=spf10 include:amazonses.com ~all",
			"v=spf1 include:amazonses.com.attacker.example ~all",
			"v=spf1 -include:amazonses.com ~all",
			"v=spf1 ~include:amazonses.com ~all",
			"v=spf1 ?include:amazonses.com ~all",
			"v=spf1 -all include:amazonses.com",
		]) {
			const misleadingSpfDns: ProviderDnsResolver = {
				...dns,
				async txt(name) {
					if (name === "bounce.news.example.com") {
						return [spfRecord];
					}
					return dns.txt(name);
				},
			};
			const output = await invokeDeliverabilityDnsCheckOperation(
				context({ dns: misleadingSpfDns }),
				{ provider_id: profile.id },
			);
			expect(output.checks).toContainEqual(
				expect.objectContaining({ id: "dns.spf", status: "fail" }),
			);
		}
	});

	test("stops SPF path discovery after an earlier matching include", async () => {
		for (const [nestedRecord, status] of [
			["v=spf1 +all", "fail"],
			["v=spf1 -all", "pass"],
		] as const) {
			const orderedSpfDns: ProviderDnsResolver = {
				...dns,
				async txt(name) {
					if (name === "bounce.news.example.com") {
						return [
							"v=spf1 -include:_spf.block.example include:amazonses.com -all",
						];
					}
					if (name === "_spf.block.example") {
						return [nestedRecord];
					}
					return dns.txt(name);
				},
			};
			const output = await invokeDeliverabilityDnsCheckOperation(
				context({ dns: orderedSpfDns }),
				{ provider_id: profile.id },
			);
			expect(output.checks).toContainEqual(
				expect.objectContaining({ id: "dns.spf", status }),
			);
		}
	});

	test("continues SPF path discovery past an unrelated earlier include", async () => {
		const orderedSpfDns: ProviderDnsResolver = {
			...dns,
			async txt(name) {
				if (name === "bounce.news.example.com") {
					return [
						"v=spf1 include:_spf.other.example include:amazonses.com -all",
					];
				}
				if (name === "_spf.other.example") {
					return ["v=spf1 ip4:198.51.100.0/24 -all"];
				}
				return dns.txt(name);
			},
		};
		const output = await invokeDeliverabilityDnsCheckOperation(
			context({ dns: orderedSpfDns }),
			{ provider_id: profile.id },
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({ id: "dns.spf", status: "pass" }),
		);
	});

	test("accepts underscored SPF targets and multiple generic SMTP MX records", async () => {
		const smtpProfile = providerProfileSchema.parse({
			id: "google-relay",
			kind: "smtp",
			sending_domain: "mail.example.com",
			mail_from_domain: "bounce.mail.example.com",
			expected_spf_include: "_spf.google.com",
			smtp_hosts: ["smtp.example.com"],
			dkim_selectors: ["mail"],
		});
		expect(smtpProfile.expected_spf_include).toBe("_spf.google.com");
		const genericDns: ProviderDnsResolver = {
			async txt(name) {
				if (name === "_dmarc.mail.example.com") {
					return ["v=DMARC1; p=quarantine"];
				}
				if (name === "bounce.mail.example.com") {
					return ["v=spf1 include:_spf.google.com ~all"];
				}
				if (name === "_spf.google.com") {
					return ["v=spf1 ip4:192.0.2.0/24 -all"];
				}
				if (name === "provider-dkim.example.net") {
					return [`k=rsa; p=${validRsaDkimPublicKey}`];
				}
				return [];
			},
			async cname(name) {
				return name === "mail._domainkey.mail.example.com"
					? ["provider-dkim.example.net"]
					: [];
			},
			async mx(name) {
				return name === "bounce.mail.example.com"
					? [
							{ priority: 10, exchange: "mx1.example.com" },
							{ priority: 20, exchange: "mx2.example.com" },
						]
					: [];
			},
			async a(name) {
				return name === "mx1.example.com" ? ["192.0.2.10"] : [];
			},
			async aaaa() {
				return [];
			},
		};
		const output = await inspectProviderDns(
			smtpProfile,
			context({ profiles: [smtpProfile], dns: genericDns }),
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({ id: "dns.spf", status: "pass" }),
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({ id: "dns.dkim", status: "pass" }),
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({
				id: "dns.mail-from-mx",
				status: "pass",
			}),
		);
	});

	test("requires address evidence for generic SMTP MX exchanges", async () => {
		const smtpProfile = providerProfileSchema.parse({
			id: "generic-mx-relay",
			kind: "smtp",
			sending_domain: "mail.example.com",
			mail_from_domain: "bounce.mail.example.com",
			expected_spf_include: "_spf.example.com",
			smtp_hosts: ["smtp.example.com"],
		});
		const baseDns: ProviderDnsResolver = {
			async txt(name) {
				if (name === "_dmarc.mail.example.com") {
					return ["v=DMARC1; p=quarantine"];
				}
				if (name === "bounce.mail.example.com") {
					return ["v=spf1 include:_spf.example.com ~all"];
				}
				if (name === "_spf.example.com") {
					return ["v=spf1 ip4:192.0.2.0/24 -all"];
				}
				return [];
			},
			async cname() {
				return [];
			},
			async mx(name) {
				return name === "bounce.mail.example.com"
					? [{ priority: 10, exchange: "missing.invalid" }]
					: [];
			},
		};
		for (const [addressResolvers, status] of [
			[
				{
					async a() {
						return [];
					},
					async aaaa() {
						return [];
					},
				},
				"fail",
			],
			[{}, "unknown"],
			[
				{
					async a() {
						throw new Error("transient resolver failure");
					},
					async aaaa() {
						return [];
					},
				},
				"unknown",
			],
		] as const) {
			const output = await inspectProviderDns(
				smtpProfile,
				context({
					profiles: [smtpProfile],
					dns: { ...baseDns, ...addressResolvers },
				}),
			);
			expect(output.checks).toContainEqual(
				expect.objectContaining({
					id: "dns.mail-from-mx",
					status,
				}),
			);
		}
	});

	test("requires the expected SPF include target to publish one SPF record", async () => {
		const smtpProfile = providerProfileSchema.parse({
			id: "dangling-spf-relay",
			kind: "smtp",
			sending_domain: "mail.example.com",
			mail_from_domain: "bounce.mail.example.com",
			expected_spf_include: "_spf.missing.example",
			smtp_hosts: ["smtp.example.com"],
		});
		const danglingSpfDns: ProviderDnsResolver = {
			async txt(name) {
				if (name === "_dmarc.mail.example.com") {
					return ["v=DMARC1; p=quarantine"];
				}
				if (name === "bounce.mail.example.com") {
					return [
						"v=spf1 include:_spf.missing.example ~all",
					];
				}
				return [];
			},
			async cname() {
				return [];
			},
			async mx(name) {
				return name === "bounce.mail.example.com"
					? [{ priority: 10, exchange: "mx.example.com" }]
					: [];
			},
		};
		const output = await inspectProviderDns(
			smtpProfile,
			context({ profiles: [smtpProfile], dns: danglingSpfDns }),
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({ id: "dns.spf", status: "fail" }),
		);
	});

	test("requires the expected SPF policy to have an authorizing path", async () => {
		const smtpProfile = providerProfileSchema.parse({
			id: "nested-spf-relay",
			kind: "smtp",
			sending_domain: "mail.example.com",
			mail_from_domain: "bounce.mail.example.com",
			expected_spf_include: "_spf.provider.example",
			smtp_hosts: ["smtp.example.com"],
		});
		for (const [providerRecord, nestedRecord, status] of [
			["v=spf1 -all", undefined, "fail"],
			["v=spf1 ip4: -all", undefined, "fail"],
			["v=spf1 ip4:192.0.2.0/33 -all", undefined, "fail"],
			[
				"v=spf1 include:_spf.missing.example ip4:192.0.2.0/24 -all",
				undefined,
				"fail",
			],
			[
				"v=spf1 include:_spf.provider.example ip4:192.0.2.0/24 -all",
				undefined,
				"fail",
			],
			[
				"v=spf1 -include:_spf.nested.example +all",
				"v=spf1 +all",
				"fail",
			],
			[
				"v=spf1 redirect=_spf.nested.example redirect=_spf.other.example",
				"v=spf1 ip4:192.0.2.0/24 -all",
				"fail",
			],
			[
				"v=spf1 include:_spf.nested.example -all",
				"v=spf1 ip4:192.0.2.0/24 -all",
				"pass",
			],
		] as const) {
			const authorizationDns: ProviderDnsResolver = {
				async txt(name) {
					if (name === "_dmarc.mail.example.com") {
						return ["v=DMARC1; p=quarantine"];
					}
					if (name === "bounce.mail.example.com") {
						return [
							"v=spf1 include:_spf.provider.example ~all",
						];
					}
					if (name === "_spf.provider.example") {
						return [providerRecord];
					}
					if (
						name === "_spf.nested.example" &&
						nestedRecord !== undefined
					) {
						return [nestedRecord];
					}
					return [];
				},
				async cname() {
					return [];
				},
				async mx(name) {
					return name === "bounce.mail.example.com"
						? [{ priority: 10, exchange: "mx.example.com" }]
						: [];
				},
			};
			const output = await inspectProviderDns(
				smtpProfile,
				context({
					profiles: [smtpProfile],
					dns: authorizationDns,
				}),
			);
			expect(output.checks).toContainEqual(
				expect.objectContaining({ id: "dns.spf", status }),
			);
		}
	});

	test("enforces the SPF DNS lookup budget across sibling includes", async () => {
		const smtpProfile = providerProfileSchema.parse({
			id: "budgeted-spf-relay",
			kind: "smtp",
			sending_domain: "mail.example.com",
			mail_from_domain: "bounce.mail.example.com",
			expected_spf_include: "_spf.provider.example",
			smtp_hosts: ["smtp.example.com"],
		});
		for (const [nonMatchingIncludes, status] of [
			[8, "pass"],
			[9, "fail"],
		] as const) {
			const includes = Array.from(
				{ length: nonMatchingIncludes },
				(_, index) => `include:_spf.no-${index}.example`,
			);
			const budgetDns: ProviderDnsResolver = {
				async txt(name) {
					if (name === "_dmarc.mail.example.com") {
						return ["v=DMARC1; p=quarantine"];
					}
					if (name === "bounce.mail.example.com") {
						return [
							"v=spf1 include:_spf.provider.example ~all",
						];
					}
					if (name === "_spf.provider.example") {
						return [
							`v=spf1 ${includes.join(" ")} include:_spf.authorizer.example -all`,
						];
					}
					if (name.startsWith("_spf.no-")) return ["v=spf1 -all"];
					if (name === "_spf.authorizer.example") {
						return ["v=spf1 ip4:192.0.2.0/24 -all"];
					}
					return [];
				},
				async cname() {
					return [];
				},
				async mx(name) {
					return name === "bounce.mail.example.com"
						? [{ priority: 10, exchange: "mx.example.com" }]
						: [];
				},
			};
			const output = await inspectProviderDns(
				smtpProfile,
				context({
					profiles: [smtpProfile],
					dns: budgetDns,
				}),
			);
			expect(output.checks).toContainEqual(
				expect.objectContaining({ id: "dns.spf", status }),
			);
		}
	});

	test("counts root SPF terms before the expected include", async () => {
		const smtpProfile = providerProfileSchema.parse({
			id: "root-budget-spf-relay",
			kind: "smtp",
			sending_domain: "mail.example.com",
			mail_from_domain: "bounce.mail.example.com",
			expected_spf_include: "_spf.provider.example",
			smtp_hosts: ["smtp.example.com"],
		});
		for (const [precedingIncludes, status] of [
			[9, "pass"],
			[10, "fail"],
		] as const) {
			const includes = Array.from(
				{ length: precedingIncludes },
				(_, index) => `include:_spf.root-no-${index}.example`,
			);
			const budgetDns: ProviderDnsResolver = {
				async txt(name) {
					if (name === "_dmarc.mail.example.com") {
						return ["v=DMARC1; p=quarantine"];
					}
					if (name === "bounce.mail.example.com") {
						return [
							`v=spf1 ${includes.join(" ")} include:_spf.provider.example -all`,
						];
					}
					if (name === "_spf.provider.example") {
						return ["v=spf1 ip4:192.0.2.0/24 -all"];
					}
					if (name.startsWith("_spf.root-no-")) {
						return ["v=spf1 -all"];
					}
					return [];
				},
				async cname() {
					return [];
				},
				async mx(name) {
					return name === "bounce.mail.example.com"
						? [{ priority: 10, exchange: "mx.example.com" }]
						: [];
				},
			};
			const output = await inspectProviderDns(
				smtpProfile,
				context({
					profiles: [smtpProfile],
					dns: budgetDns,
				}),
			);
			expect(output.checks).toContainEqual(
				expect.objectContaining({ id: "dns.spf", status }),
			);
		}
	});

	test("enforces the SPF void-lookup budget in root and recursive policies", async () => {
		const smtpProfile = providerProfileSchema.parse({
			id: "void-budget-spf-relay",
			kind: "smtp",
			sending_domain: "mail.example.com",
			mail_from_domain: "bounce.mail.example.com",
			expected_spf_include: "_spf.provider.example",
			smtp_hosts: ["smtp.example.com"],
		});
		for (const scope of ["root", "recursive"] as const) {
			for (const [voidLookups, status] of [
				[2, "pass"],
				[3, "fail"],
			] as const) {
				const exists = Array.from(
					{ length: voidLookups },
					(_, index) => `exists:void-${scope}-${index}.example`,
				).join(" ");
				const voidDns: ProviderDnsResolver = {
					async txt(name) {
						if (name === "_dmarc.mail.example.com") {
							return ["v=DMARC1; p=quarantine"];
						}
						if (name === "bounce.mail.example.com") {
							return [
								scope === "root"
									? `v=spf1 ${exists} include:_spf.provider.example -all`
									: "v=spf1 include:_spf.provider.example -all",
							];
						}
						if (name === "_spf.provider.example") {
							return [
								scope === "recursive"
									? `v=spf1 ${exists} ip4:192.0.2.0/24 -all`
									: "v=spf1 ip4:192.0.2.0/24 -all",
							];
						}
						return [];
					},
					async cname() {
						return [];
					},
					async mx(name) {
						return name === "bounce.mail.example.com"
							? [{ priority: 10, exchange: "mx.example.com" }]
							: [];
					},
					async a() {
						return [];
					},
				};
				const output = await inspectProviderDns(
					smtpProfile,
					context({
						profiles: [smtpProfile],
						dns: voidDns,
					}),
				);
				expect(output.checks).toContainEqual(
					expect.objectContaining({ id: "dns.spf", status }),
				);
			}
		}
	});

	test("requires DNS evidence for SPF a, mx, and exists mechanisms", async () => {
		const smtpProfile = providerProfileSchema.parse({
			id: "dns-evidence-spf-relay",
			kind: "smtp",
			sending_domain: "mail.example.com",
			mail_from_domain: "bounce.mail.example.com",
			expected_spf_include: "_spf.provider.example",
			smtp_hosts: ["smtp.example.com"],
		});
		for (const [mechanism, status] of [
			["a:missing.example", "fail"],
			["mx:missing.example", "fail"],
			["exists:missing.example", "fail"],
			["exists:found.example", "pass"],
		] as const) {
			const evidenceDns: ProviderDnsResolver = {
				async txt(name) {
					if (name === "_dmarc.mail.example.com") {
						return ["v=DMARC1; p=quarantine"];
					}
					if (name === "bounce.mail.example.com") {
						return [
							"v=spf1 include:_spf.provider.example -all",
						];
					}
					if (name === "_spf.provider.example") {
						return [`v=spf1 ${mechanism} -all`];
					}
					return [];
				},
				async cname() {
					return [];
				},
				async mx(name) {
					return name === "bounce.mail.example.com"
						? [{ priority: 10, exchange: "mx.example.com" }]
						: [];
				},
				async a(name) {
					return name === "found.example" ? ["192.0.2.10"] : [];
				},
				async aaaa() {
					return [];
				},
			};
			const output = await inspectProviderDns(
				smtpProfile,
				context({
					profiles: [smtpProfile],
					dns: evidenceDns,
				}),
			);
			expect(output.checks).toContainEqual(
				expect.objectContaining({ id: "dns.spf", status }),
			);
		}
	});

	test("rejects a generic SMTP null MX record", async () => {
		const smtpProfile = providerProfileSchema.parse({
			id: "null-mx-relay",
			kind: "smtp",
			sending_domain: "mail.example.com",
			mail_from_domain: "bounce.mail.example.com",
			expected_spf_include: "_spf.example.com",
			smtp_hosts: ["smtp.example.com"],
		});
		const nullMxDns: ProviderDnsResolver = {
			async txt(name) {
				if (name === "_dmarc.mail.example.com") {
					return ["v=DMARC1; p=quarantine"];
				}
				if (name === "bounce.mail.example.com") {
					return ["v=spf1 include:_spf.example.com ~all"];
				}
				return [];
			},
			async cname() {
				return [];
			},
			async mx(name) {
				return name === "bounce.mail.example.com"
					? [{ priority: 0, exchange: "." }]
					: [];
			},
		};
		const output = await inspectProviderDns(
			smtpProfile,
			context({ profiles: [smtpProfile], dns: nullMxDns }),
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({
				id: "dns.mail-from-mx",
				status: "fail",
			}),
		);
	});

	test("requires SES custom MAIL FROM MX preference 10", async () => {
		const wrongPreferenceDns: ProviderDnsResolver = {
			...dns,
			async mx(name) {
				if (name === "bounce.news.example.com") {
					return [
						{
							priority: 0,
							exchange:
								"feedback-smtp.ap-northeast-2.amazonses.com",
						},
					];
				}
				return dns.mx(name);
			},
		};
		const output = await invokeDeliverabilityDnsCheckOperation(
			context({ dns: wrongPreferenceDns }),
			{ provider_id: profile.id },
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({
				id: "dns.mail-from-mx",
				status: "fail",
			}),
		);
	});

	test("uses the China SES custom MAIL FROM MX suffix", async () => {
		const chinaProfile = providerProfileSchema.parse({
			...profile,
			id: "china-marketing",
			region: "cn-north-1",
		});
		const chinaDns: ProviderDnsResolver = {
			...dns,
			async mx(name) {
				return name === "bounce.news.example.com"
					? [
							{
								priority: 10,
								exchange:
									"feedback-smtp.cn-north-1.amazonses.com.cn",
							},
						]
					: [];
			},
		};
		const output = await inspectProviderDns(
			chinaProfile,
			context({ profiles: [chinaProfile], dns: chinaDns }),
			await inspector().inspectIdentity(),
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({
				id: "dns.mail-from-mx",
				status: "pass",
			}),
		);
	});

	test("rejects a dangling generic DKIM delegation", async () => {
		const smtpProfile = providerProfileSchema.parse({
			id: "dangling-relay",
			kind: "smtp",
			sending_domain: "mail.example.com",
			dkim_selectors: ["mail"],
			smtp_hosts: ["smtp.example.com"],
		});
		const danglingDns: ProviderDnsResolver = {
			async txt(name) {
				if (name === "_dmarc.mail.example.com") {
					return ["v=DMARC1; p=quarantine"];
				}
				return [];
			},
			async cname(name) {
				return name === "mail._domainkey.mail.example.com"
					? ["missing-key.example.net"]
					: [];
			},
			async mx() {
				return [];
			},
		};
		const output = await inspectProviderDns(
			smtpProfile,
			context({ profiles: [smtpProfile], dns: danglingDns }),
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({ id: "dns.dkim", status: "fail" }),
		);
	});

	test("accepts a generic SMTP direct SPF authorization policy", async () => {
		const smtpProfile = providerProfileSchema.parse({
			id: "direct-policy-relay",
			kind: "smtp",
			sending_domain: "mail.example.com",
			mail_from_domain: "bounce.mail.example.com",
			expected_spf_ip_ranges: ["203.0.113.10"],
			smtp_hosts: ["smtp.example.com"],
		});
		const directSpfDns: ProviderDnsResolver = {
			async txt(name) {
				if (name === "_dmarc.mail.example.com") {
					return ["v=DMARC1; p=quarantine"];
				}
				if (name === "bounce.mail.example.com") {
					return ["v=spf1 ip4:203.0.113.10 -all"];
				}
				return [];
			},
			async cname() {
				return [];
			},
			async mx(name) {
				return name === "bounce.mail.example.com"
					? [{ priority: 10, exchange: "mx.example.com" }]
					: [];
			},
			async a(name) {
				return name === "mx.example.com" ? ["203.0.113.10"] : [];
			},
			async aaaa() {
				return [];
			},
		};
		const output = await inspectProviderDns(
			smtpProfile,
			context({ profiles: [smtpProfile], dns: directSpfDns }),
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({ id: "dns.spf", status: "pass" }),
		);
	});

	test("requires a generic direct SPF policy to match the configured sender range", async () => {
		const smtpProfile = providerProfileSchema.parse({
			id: "mismatched-direct-policy-relay",
			kind: "smtp",
			sending_domain: "mail.example.com",
			mail_from_domain: "bounce.mail.example.com",
			expected_spf_ip_ranges: ["203.0.113.20"],
			smtp_hosts: ["smtp.example.com"],
		});
		const output = await inspectProviderDns(
			smtpProfile,
			context({
				profiles: [smtpProfile],
				dns: {
					async txt(name) {
						if (name === "_dmarc.mail.example.com") {
							return ["v=DMARC1; p=quarantine"];
						}
						if (name === "bounce.mail.example.com") {
							return ["v=spf1 ip4:203.0.113.10 -all"];
						}
						return [];
					},
					async cname() {
						return [];
					},
					async mx(name) {
						return name === "bounce.mail.example.com"
							? [{ priority: 10, exchange: "mx.example.com" }]
							: [];
					},
					async a(name) {
						return name === "mx.example.com"
							? ["203.0.113.10"]
							: [];
					},
					async aaaa() {
						return [];
					},
				},
			}),
		);
		expect(output.checks).toContainEqual(
			expect.objectContaining({ id: "dns.spf", status: "fail" }),
		);
	});

	test("rejects a generic SMTP SPF policy without an authorization path", async () => {
		const smtpProfile = providerProfileSchema.parse({
			id: "unverified-relay",
			kind: "smtp",
			sending_domain: "mail.example.com",
			mail_from_domain: "bounce.mail.example.com",
			expected_spf_ip_ranges: ["203.0.113.10"],
			smtp_hosts: ["smtp.example.com"],
		});
		const unverifiedSpfDns: ProviderDnsResolver = {
			async txt(name) {
				if (name === "_dmarc.mail.example.com") {
					return ["v=DMARC1; p=quarantine"];
				}
				if (name === "bounce.mail.example.com") {
					return ["v=spf1 -all"];
				}
				return [];
			},
			async cname() {
				return [];
			},
			async mx(name) {
				return name === "bounce.mail.example.com"
					? [{ priority: 10, exchange: "mx.example.com" }]
					: [];
			},
		};
		const output = await inspectProviderDns(
			smtpProfile,
			context({ profiles: [smtpProfile], dns: unverifiedSpfDns }),
		);
		expect(output.healthy).toBe(false);
		expect(output.checks).toContainEqual(
			expect.objectContaining({ id: "dns.spf", status: "fail" }),
		);
	});

	test("preserves operation results when provider cleanup fails", async () => {
		const cleanupFailureInspector = inspector();
		cleanupFailureInspector.close = () => {
			throw new Error("cleanup failed");
		};
		const output = await invokeProviderTestOperation(
			context({ createInspector: () => cleanupFailureInspector }),
			{ provider_id: profile.id },
		);
		expect(output.probe.authenticated).toBe(true);
	});

	test("reports unavailable SES identity evidence in standalone DNS checks", async () => {
		const identityFailureInspector = inspector();
		identityFailureInspector.inspectIdentity = async () => {
			throw new Error("identity unavailable");
		};
		const output = await invokeDeliverabilityDnsCheckOperation(
			context({ createInspector: () => identityFailureInspector }),
			{ provider_id: profile.id },
		);
		expect(output.checks[0]).toMatchObject({
			id: "provider.identity",
			status: "unknown",
		});
	});

	test("does not claim API support for generic SMTP", async () => {
		const smtpProfile = providerProfileSchema.parse({
			id: "relay",
			kind: "smtp",
			sending_domain: "mail.example.com",
			smtp_hosts: ["mailpit"],
		});
		expect(smtpProfile.smtp_hosts).toEqual(["mailpit"]);
		const output = await invokeProviderTestOperation(
			context({
				profiles: [smtpProfile],
				createInspector: () => undefined,
			}),
			{ provider_id: smtpProfile.id },
		);
		expect(output.probe).toEqual({
			supported: false,
			reachable: false,
			authenticated: false,
		});
		expect(() =>
			providerProfileSchema.parse({
				id: "unsafe",
				kind: "smtp",
				sending_domain: "mail.example.com",
				secret_ref: "raw-secret",
			}),
		).toThrow();
		expect(() =>
			providerProfileSchema.parse({
				id: "missing-host",
				kind: "smtp",
				sending_domain: "mail.example.com",
			}),
		).toThrow("require an SMTP host");
	});
});

describe("provider profile loader", () => {
	const temporaryDirectories: string[] = [];

	afterEach(async () => {
		await Promise.all(
			temporaryDirectories.splice(0).map((path) =>
				rm(path, { recursive: true, force: true }),
			),
		);
	});

	test("loads a versioned config through the environment path", async () => {
		const directory = await mkdtemp(join(tmpdir(), "listmonk-provider-"));
		temporaryDirectories.push(directory);
		const path = join(directory, "providers.json");
		await writeFile(
			path,
			JSON.stringify({ schema_version: 1, profiles: [profile] }),
			"utf8",
		);
		const output = await invokeProviderListOperation(
			{
				profiles: async () => {
					const { loadProviderProfiles } = await import("../src");
					return loadProviderProfiles({ path });
				},
			},
			{},
		);
		expect(output.profiles).toHaveLength(1);
	});

	test("does not expose malformed JSON source excerpts", async () => {
		const directory = await mkdtemp(join(tmpdir(), "listmonk-provider-"));
		temporaryDirectories.push(directory);
		const path = join(directory, "providers.json");
		const credentialExcerpt = "must-not-leak-provider-secret";
		await writeFile(
			path,
			`{"schema_version":1,"secret":${credentialExcerpt}}`,
			"utf8",
		);
		await expect(loadProviderProfiles({ path })).rejects.toThrow(
			"Failed to parse provider config JSON",
		);
		await expect(loadProviderProfiles({ path })).rejects.not.toThrow(
			credentialExcerpt,
		);
	});

	test("rejects duplicate IDs and raw credential material", () => {
		expect(() =>
			providerConfigSchema.parse({
				schema_version: 1,
				profiles: [profile, profile],
			}),
		).toThrow("Duplicate provider profile id");
		expect(() =>
			providerProfileSchema.parse({
				id: "marketing",
				kind: "ses",
				sending_domain: "news.example.com",
				region: "ap-northeast-2",
				secret_ref: "AKIAABCDEFGHIJKLMNOP",
			}),
		).toThrow();
		expect(() =>
			providerProfileSchema.parse({
				...profile,
				password: "must-not-be-accepted",
			}),
		).toThrow("Unrecognized key");
	});

	test("accepts dotted DKIM selector subdomains", () => {
		const parsed = providerProfileSchema.parse({
			...profile,
			dkim_selectors: ["mail.eu"],
		});
		expect(parsed.dkim_selectors).toEqual(["mail.eu"]);
		expect(() =>
			providerProfileSchema.parse({
				...profile,
				dkim_selectors: ["mail..eu"],
			}),
		).toThrow();
	});

	test("rejects invalid SES regions and oversized DKIM owner names", () => {
		for (const region of ["us east 1", "us/east/1", "useast1"]) {
			expect(() =>
				providerProfileSchema.parse({ ...profile, region }),
			).toThrow();
		}
		const longDomain = [
			"a".repeat(63),
			"b".repeat(63),
			"c".repeat(63),
			"d".repeat(45),
			"com",
		].join(".");
		expect(() =>
			providerProfileSchema.parse({
				...profile,
				sending_domain: longDomain,
				dkim_selectors: ["selector"],
			}),
		).toThrow("DNS owner name longer than 253 characters");
	});

	test("does not expose an inaccessible provider config path", async () => {
		const missingPath = join(tmpdir(), "private-provider-config.json");
		await expect(loadProviderProfiles({ path: missingPath })).rejects.toThrow(
			"Provider config is not accessible",
		);
		await expect(loadProviderProfiles({ path: missingPath })).rejects.not.toThrow(
			missingPath,
		);
	});
});
