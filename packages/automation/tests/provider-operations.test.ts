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
	loadProviderProfiles,
	providerOperationCatalog,
	providerProfileSchema,
	type ProviderDnsResolver,
	type ProviderInspector,
	type ProviderOperationContext,
	type ProviderProfile,
} from "../src";

const fixedNow = new Date("2026-07-29T00:00:00.000Z");
const profile = providerProfileSchema.parse({
	id: "marketing-primary",
	kind: "ses",
	messenger: "email",
	sending_domain: "news.example.com",
	from_email: "newsletter@news.example.com",
	region: "ap-northeast-2",
	secret_ref: "aws:profile:newsletter",
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

	test("rejects duplicate IDs and raw credential material", () => {
		expect(() =>
			providerProfileSchema.parse({
				id: "marketing",
				kind: "ses",
				sending_domain: "news.example.com",
				region: "ap-northeast-2",
				secret_ref: "AKIAABCDEFGHIJKLMNOP",
			}),
		).toThrow();
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
