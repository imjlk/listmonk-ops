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

	test("requires the configured Listmonk messenger and real From evidence", async () => {
		const missing = inspectListmonkProviderSettings(
			{ ...profile, messenger: "marketing" },
			{
				smtp: [
					{
						name: "wrong",
						host: "email-smtp.ap-northeast-2.amazonaws.com",
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
			{ ...profile, messenger: "marketing" },
			{
				"app.from_email": "not-an-email",
				smtp: [
					{
						name: "wrong",
						host: "email-smtp.ap-northeast-2.amazonaws.com",
						enabled: true,
					},
				],
				messengers: [{ name: "marketing", enabled: true }],
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
			{ ...profile, messenger: "marketing" },
			{
				messengers: [{ name: "marketing" }],
			},
		);
		expect(malformedEnabled).toMatchObject({
			messenger_configured: true,
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

	test("supports inherited DMARC, direct DKIM TXT, and relaxed sibling alignment", async () => {
		const inheritedDns: ProviderDnsResolver = {
			async txt(name) {
				if (name === "_dmarc.example.com") {
					return ["v=DMARC1; p=quarantine"];
				}
				if (name.endsWith("._domainkey.news.example.com")) {
					return ["v=DKIM1; k=rsa; p=public-key"];
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
			"dns.spf",
			"dns.mail-from-mx",
			"dns.spf-alignment",
		]) {
			expect(output.checks).toContainEqual(
				expect.objectContaining({ id, status: "unknown" }),
			);
		}
	});

	test("requires a positively qualified exact SPF include mechanism", async () => {
		for (const spfRecord of [
			"v=spf1 include:amazonses.com.attacker.example ~all",
			"v=spf1 -include:amazonses.com ~all",
			"v=spf1 ~include:amazonses.com ~all",
			"v=spf1 ?include:amazonses.com ~all",
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
