import { describe, expect, test } from "bun:test";
import {
	providerProfileSchema,
	type ProviderDnsResolver,
	type ProviderInspector,
} from "@listmonk-ops/automation";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	createProviderToolsHandler,
	providerTools,
} from "../../src/handlers/providers.js";
import type { CallToolRequest } from "../../src/types/mcp.js";

const validRsaDkimPublicKey =
	"MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCiRZP7BQUD9YLLLsAGRpKXPw/vidM72qPEBYY7HOv+NJ58tSojO2KTq3tOjWd0XVZA7c4r5k8ZnnIbUIa9fj/5Xkiu7c3mZ0aaJIjJsF1N9G7OYHV/nipUAzGJNDXY4N1MFPBHYwJMbpDRCMtSF7IejXWFm3m586oXZANtNvGw0wIDAQAB";

function request(
	name: string,
	arguments_: Record<string, unknown> = {},
): CallToolRequest {
	return {
		method: "tools/call",
		params: { name, arguments: arguments_ },
	};
}

const profile = providerProfileSchema.parse({
	id: "marketing",
	kind: "ses",
	sending_domain: "news.example.com",
	from_email: "newsletter@news.example.com",
	region: "ap-northeast-2",
	secret_ref: "aws:default",
});

const inspector: ProviderInspector = {
	async inspectAccount() {
		return {
			production_access_enabled: true,
			sending_enabled: true,
			enforcement_status: "HEALTHY",
			max_24_hour_send: 10_000,
			max_send_rate: 10,
			sent_last_24_hours: 1_000,
			suppressed_reasons: ["BOUNCE", "COMPLAINT"],
		};
	},
	async inspectIdentity() {
		return {
			verified_for_sending: true,
			verification_status: "SUCCESS",
			dkim_signing_enabled: true,
			dkim_status: "SUCCESS",
			dkim_tokens: ["a", "b", "c"],
			mail_from_domain: "bounce.news.example.com",
			mail_from_status: "SUCCESS",
		};
	},
	close() {},
};

const dns: ProviderDnsResolver = {
	async txt(name) {
		if (name === "_dmarc.news.example.com") {
			return ["v=DMARC1; p=reject"];
		}
		if (name.startsWith("bounce.")) {
			return ["v=spf1 include:amazonses.com ~all"];
		}
		if (name === "amazonses.com") {
			return ["v=spf1 ip4:192.0.2.0/24 -all"];
		}
		if (name.endsWith(".dkim.amazonses.com")) {
			return [`v=DKIM1; p=${validRsaDkimPublicKey}`];
		}
		return [];
	},
	async cname(name) {
		return [`${name.split(".")[0]}.dkim.amazonses.com`];
	},
	async mx() {
		return [
			{
				priority: 10,
				exchange: "feedback-smtp.ap-northeast-2.amazonses.com",
			},
		];
	},
};

const client = {
	settings: {
		async get() {
			return {
				data: {
					"app.from_email": "newsletter@news.example.com",
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
			};
		},
	},
	bounce: {
		async list() {
			return {
				data: {
					results: [
						{
							source: "ses",
							type: "complaint",
							created_at: "2026-07-29T00:00:00.000Z",
						},
					],
					total: 1,
					per_page: 1,
					page: 1,
				},
			};
		},
	},
} as unknown as ListmonkClient;

describe("MCP provider tools", () => {
	test("publishes seven read-only typed tools", () => {
		expect(providerTools).toHaveLength(7);
		for (const tool of providerTools) {
			expect(tool.annotations).toMatchObject({
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			});
			expect(tool.outputSchema?.type).toBe("object");
		}
	});

	test("uses the shared doctor executor and redacts credential references", async () => {
		const handler = createProviderToolsHandler({
			profiles: [profile],
			createInspector: () => inspector,
			dns,
			now: () => new Date("2026-07-29T01:00:00.000Z"),
		});
		const result = await handler(
			request("listmonk_deliverability_doctor", {
				provider_id: profile.id,
			}),
			client,
		);
		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
			provider_id: profile.id,
			ready: true,
			summary: { fail: 0 },
		});
		expect(JSON.stringify(result.structuredContent)).not.toContain(
			"aws:default",
		);
	});

	test("rejects unknown provider profiles through the shared contract", async () => {
		const handler = createProviderToolsHandler({ profiles: [profile] });
		const result = await handler(
			request("listmonk_providers_status", {
				provider_id: "missing",
			}),
			client,
		);
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("Unknown provider profile");
	});
});
