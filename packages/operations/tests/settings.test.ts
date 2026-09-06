import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import {
	redactSettingsCredentials,
	SETTINGS_REDACTED_VALUE,
	invokeGetSettingsOperation,
	invokeSettingsOperationByMcpName,
	settingsOperations,
} from "../src/settings";

type SettingsClient = Pick<ListmonkClient, "settings">;

function settingsContext(
	methods: Partial<SettingsClient["settings"]>,
): { client: SettingsClient } {
	return { client: { settings: methods } as SettingsClient };
}

describe("settings credential redaction", () => {
	test("redacts credential fields at every depth", () => {
		const document = {
			"app.from_email": "listmonk <noreply@example.com>",
			"upload.s3.aws_access_key_id": "AKIAEXAMPLE",
			"bounce.forwardemail_key": "FE.secret",
			"bounce.postmark_username": "postmark-server-token",
			"upload.s3.aws_secret_access_key": "secret-value",
			"bounce.sendgrid_key": "SG.xxxx",
			smtp: [
				{
					name: "primary",
					host: "smtp.example.com",
					username: "user",
					password: "hunter2",
				},
			],
			"security.oidc": {
				client_id: "public-id",
				client_secret: "oidc-secret",
			},
			security: { captcha: { hcaptcha: { key: "hc-key" } } },
			"app.batch_size": 1000,
		};

		const redacted = redactSettingsCredentials(document) as Record<
			string,
			unknown
		>;

		expect(redacted["app.from_email"]).toBe("listmonk <noreply@example.com>");
		expect(redacted["upload.s3.aws_secret_access_key"]).toBe(
			SETTINGS_REDACTED_VALUE,
		);
		expect(redacted["bounce.sendgrid_key"]).toBe(SETTINGS_REDACTED_VALUE);
		expect(redacted["bounce.forwardemail_key"]).toBe(
			SETTINGS_REDACTED_VALUE,
		);
		expect(redacted["bounce.postmark_username"]).toBe(
			SETTINGS_REDACTED_VALUE,
		);
		expect(
			(redacted.smtp as { password?: unknown }[])[0]?.password,
		).toBe(SETTINGS_REDACTED_VALUE);
		expect(
			(redacted.smtp as { host?: unknown }[])[0]?.host,
		).toBe("smtp.example.com");
		expect(redacted["app.batch_size"]).toBe(1000);
		const oidc = redacted["security.oidc"] as Record<string, unknown>;
		expect(oidc.client_id).toBe("public-id");
		expect(oidc.client_secret).toBe(SETTINGS_REDACTED_VALUE);
		const captcha = (
			(redacted.security as Record<string, unknown>).captcha as Record<
				string,
				Record<string, unknown>
			>
		).hcaptcha;
		expect(captcha.key).toBe(SETTINGS_REDACTED_VALUE);
		// The redaction must not mutate the source document.
		expect(document.smtp?.[0]?.password).toBe("hunter2");
	});

	test("cannot be poisoned through a __proto__ key", () => {
		const redacted = redactSettingsCredentials({
			__proto__: { polluted: true },
			safe: 1,
		}) as Record<string, unknown>;
		expect(redacted.safe).toBe(1);
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});

	test("passes scalars and empty structures through", () => {
		expect(redactSettingsCredentials("plain")).toBe("plain");
		expect(redactSettingsCredentials(7)).toBe(7);
		expect(redactSettingsCredentials([])).toEqual([]);
		expect(redactSettingsCredentials(null)).toBe(null);
	});
});

describe("settings get operation", () => {
	test("reads the document through the redacting executor", async () => {
		const get = mock(async () => ({
			data: {
				"app.site_name": "Mailing list",
				"bounce.sendgrid_key": "SG.secret",
			},
		}));

		await expect(
			invokeGetSettingsOperation(
				settingsContext({
					get: get as unknown as SettingsClient["settings"]["get"],
				}),
				{},
			),
		).resolves.toEqual({
			settings: {
				"app.site_name": "Mailing list",
				"bounce.sendgrid_key": SETTINGS_REDACTED_VALUE,
			},
		});
		expect(get).toHaveBeenCalledTimes(1);
	});

	test("registers the operation with read-only safety and dispatches by name", async () => {
		expect(settingsOperations).toHaveLength(1);
		expect(settingsOperations[0]?.safety).toEqual({
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: true,
		});

		const get = mock(async () => ({ data: { "app.lang": "en" } }));
		const context = settingsContext({
			get: get as unknown as SettingsClient["settings"]["get"],
		});
		await expect(
			invokeSettingsOperationByMcpName(context, "listmonk_get_settings", {}),
		).resolves.toMatchObject({
			operation: settingsOperations[0],
			output: { settings: { "app.lang": "en" } },
		});
		await expect(
			invokeSettingsOperationByMcpName(context, "listmonk_unknown", {}),
		).resolves.toBe(undefined);
	});
});
