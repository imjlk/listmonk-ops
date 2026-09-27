import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import {
	invokeTestSmtpOperation,
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

/**
 * A Listmonk 6.2 `GET /api/settings` document (models.Settings) as the
 * handler returns it: passwords, the S3 secret, the SendGrid key, the Azure
 * shared secret, the Postmark password, the ForwardEmail and Lettermint
 * keys, the hCaptcha secret, and the OIDC client secret arrive masked with
 * one "•" per character, while every auth username, the hCaptcha site key,
 * and the S3 access key id arrive in clear text.
 */
function listmonk62SettingsDocument() {
	return {
		"app.site_name": "Mailing list",
		"app.root_url": "https://lists.example.com",
		"app.from_email": "listmonk <noreply@example.com>",
		"app.notify_emails": ["ops@example.com"],
		"app.batch_size": 1000,
		"app.concurrency": 10,
		"privacy.unsubscribe_header": true,
		"privacy.exportable": ["profile", "subscriptions"],
		"security.captcha": {
			altcha: { enabled: false, complexity: 300000 },
			hcaptcha: {
				enabled: true,
				key: "10000000-ffff-ffff-ffff-000000000001",
				secret: "••••••••••••",
			},
		},
		"security.oidc": {
			enabled: true,
			provider_url: "https://id.example.com",
			provider_name: "Example ID",
			client_id: "listmonk-public-client",
			client_secret: "••••••••••",
			auto_create_users: false,
			default_user_role_id: null,
			default_list_role_id: null,
		},
		"security.trusted_urls": [],
		"upload.provider": "s3",
		"upload.s3.url": "https://s3.ap-northeast-2.amazonaws.com",
		"upload.s3.aws_access_key_id": "AKIAIOSFODNN7EXAMPLE",
		"upload.s3.aws_default_region": "ap-northeast-2",
		"upload.s3.aws_secret_access_key": "••••••••••••••••••••",
		"upload.s3.bucket": "listmonk-media",
		smtp: [
			{
				name: "email-postmark",
				uuid: "2e8c0f4a-2f6b-4a55-9f1e-7d3c2b1a0e9f",
				enabled: true,
				host: "smtp.postmarkapp.com",
				hello_hostname: "",
				port: 587,
				auth_protocol: "plain",
				username: "pm-server-token-7c1d",
				password: "••••••••••••••••••••",
				email_headers: [{ "X-PM-Message-Stream": "broadcast" }],
				max_conns: 10,
				max_msg_retries: 2,
				msg_retry_delay: "5s",
				idle_timeout: "15s",
				wait_timeout: "5s",
				tls_type: "STARTTLS",
				tls_skip_verify: false,
				from_addresses: null,
			},
			{
				name: "email-ses",
				uuid: "5a9d7e61-8c2b-4f3a-b6d4-1e0f9c8b7a6d",
				enabled: true,
				host: "email-smtp.ap-northeast-2.amazonaws.com",
				hello_hostname: "",
				port: 465,
				auth_protocol: "login",
				username: "AKIASESSMTPUSEREXAMPLE",
				password: "••••••••••••••••••••••••••••••••••••••••••••",
				email_headers: [],
				max_conns: 10,
				max_msg_retries: 2,
				msg_retry_delay: "5s",
				idle_timeout: "15s",
				wait_timeout: "5s",
				tls_type: "TLS",
				tls_skip_verify: false,
				from_addresses: ["news@example.com"],
			},
		],
		messengers: [
			{
				uuid: "c0ffee00-1111-4222-8333-444455556666",
				enabled: true,
				name: "sms-gateway",
				root_url: "https://sms.example.com/listmonk",
				username: "sms-gateway-user",
				password: "••••••••",
				max_conns: 5,
				timeout: "5s",
				max_msg_retries: 2,
			},
		],
		"bounce.enabled": true,
		"bounce.webhooks_enabled": true,
		"bounce.actions": {
			soft: { count: 2, action: "none" },
			hard: { count: 1, action: "blocklist" },
			complaint: { count: 1, action: "blocklist" },
		},
		"bounce.ses_enabled": true,
		"bounce.sendgrid_enabled": false,
		"bounce.sendgrid_key": "••••••••••••••••••••",
		"bounce.azure": {
			enabled: false,
			shared_secret: "••••••••••••",
			shared_secret_header: "X-Listmonk-Shared-Secret",
		},
		"bounce.postmark": {
			enabled: true,
			username: "pm-webhook-server-token",
			password: "••••••••••••",
		},
		"bounce.forwardemail": { enabled: false, key: "••••••••" },
		"bounce.lettermint": { enabled: false, key: "••••••••" },
		"bounce.mailboxes": [
			{
				uuid: "0badf00d-aaaa-4bbb-8ccc-dddddddddddd",
				enabled: true,
				type: "pop",
				host: "pop.example.com",
				port: 995,
				auth_protocol: "userpass",
				return_path: "bounces@example.com",
				username: "bounces@example.com",
				password: "••••••••••••",
				tls_enabled: true,
				tls_skip_verify: false,
				scan_interval: "15m",
			},
		],
		"maintenance.db": { vacuum: false, vacuum_cron_interval: "0 2 * * *" },
		"appearance.admin.custom_css": "",
		"appearance.public.custom_css": "",
	};
}

describe("settings credential redaction", () => {
	test("redacts every credential in the Listmonk 6.2 settings document", () => {
		const document = listmonk62SettingsDocument();
		const redacted = redactSettingsCredentials(document) as ReturnType<
			typeof listmonk62SettingsDocument
		>;

		// Upstream returns these in clear text; none may pass through. The
		// hCaptcha site key is public, but the generic `key` rule keeps it
		// redacted along with every other provider key.
		const clearTextCredentials = [
			"10000000-ffff-ffff-ffff-000000000001",
			"AKIAIOSFODNN7EXAMPLE",
			"pm-server-token-7c1d",
			"AKIASESSMTPUSEREXAMPLE",
			"sms-gateway-user",
			"pm-webhook-server-token",
		];
		const serialized = JSON.stringify(redacted);
		for (const credential of clearTextCredentials) {
			expect(serialized).not.toContain(credential);
		}
		expect(serialized).not.toContain("•");

		expect(redacted["bounce.postmark"]).toEqual({
			enabled: true,
			username: SETTINGS_REDACTED_VALUE,
			password: SETTINGS_REDACTED_VALUE,
		});
		for (const server of redacted.smtp) {
			expect(server.username).toBe(SETTINGS_REDACTED_VALUE);
			expect(server.password).toBe(SETTINGS_REDACTED_VALUE);
		}
		expect(redacted.messengers[0]?.username).toBe(SETTINGS_REDACTED_VALUE);
		expect(redacted.messengers[0]?.password).toBe(SETTINGS_REDACTED_VALUE);
		expect(redacted["bounce.mailboxes"][0]?.username).toBe(
			SETTINGS_REDACTED_VALUE,
		);
		expect(redacted["bounce.mailboxes"][0]?.password).toBe(
			SETTINGS_REDACTED_VALUE,
		);
		expect(redacted["bounce.sendgrid_key"]).toBe(SETTINGS_REDACTED_VALUE);
		expect(redacted["bounce.azure"].shared_secret).toBe(
			SETTINGS_REDACTED_VALUE,
		);
		expect(redacted["bounce.forwardemail"].key).toBe(SETTINGS_REDACTED_VALUE);
		expect(redacted["bounce.lettermint"].key).toBe(SETTINGS_REDACTED_VALUE);
		expect(redacted["security.captcha"].hcaptcha.secret).toBe(
			SETTINGS_REDACTED_VALUE,
		);
		expect(redacted["security.oidc"].client_secret).toBe(
			SETTINGS_REDACTED_VALUE,
		);
		expect(redacted["upload.s3.aws_access_key_id"]).toBe(
			SETTINGS_REDACTED_VALUE,
		);
		expect(redacted["upload.s3.aws_secret_access_key"]).toBe(
			SETTINGS_REDACTED_VALUE,
		);

		// Non-secret configuration stays inspectable.
		expect(redacted["app.from_email"]).toBe("listmonk <noreply@example.com>");
		expect(redacted["app.batch_size"]).toBe(1000);
		expect(redacted["security.oidc"].client_id).toBe("listmonk-public-client");
		expect(redacted["security.oidc"].provider_url).toBe(
			"https://id.example.com",
		);
		expect(redacted.smtp[1]).toMatchObject({
			name: "email-ses",
			host: "email-smtp.ap-northeast-2.amazonaws.com",
			port: 465,
			auth_protocol: "login",
			tls_type: "TLS",
			from_addresses: ["news@example.com"],
		});
		expect(redacted.messengers[0]?.root_url).toBe(
			"https://sms.example.com/listmonk",
		);
		expect(redacted["bounce.mailboxes"][0]).toMatchObject({
			host: "pop.example.com",
			return_path: "bounces@example.com",
		});
		expect(redacted["bounce.actions"]).toEqual(document["bounce.actions"]);
		expect(redacted["upload.s3.bucket"]).toBe("listmonk-media");
		// The redaction must not mutate the source document.
		expect(document.smtp[0]?.username).toBe("pm-server-token-7c1d");
	});

	test("redacts flattened keys by their last segment", () => {
		const redacted = redactSettingsCredentials({
			"bounce.postmark.username": "pm-webhook-server-token",
			"bounce.forwardemail.key": "fe-key",
			"security.captcha.hcaptcha.secret": "hc-secret",
			"bounce.postmark.enabled": true,
			"upload.s3.bucket": "listmonk-media",
		});
		expect(redacted).toEqual({
			"bounce.postmark.username": SETTINGS_REDACTED_VALUE,
			"bounce.forwardemail.key": SETTINGS_REDACTED_VALUE,
			"security.captcha.hcaptcha.secret": SETTINGS_REDACTED_VALUE,
			"bounce.postmark.enabled": true,
			"upload.s3.bucket": "listmonk-media",
		});
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
		expect(settingsOperations).toHaveLength(2);
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

describe("settings test-smtp operation", () => {
	test("sends a real test message and returns the log lines", async () => {
		const testSmtp = mock(async () => ({
			data: ["line one", "line two"],
		}));

		await expect(
			invokeTestSmtpOperation(
				settingsContext({
					testSmtp: testSmtp as unknown as SettingsClient["settings"]["testSmtp"],
				}),
				{
					email: "Reader@example.com",
					server: { host: "mailpit", port: 1025 },
				},
			),
		).resolves.toEqual({ sent: true, logs: ["line one", "line two"] });

		const body = (testSmtp.mock.calls[0]?.[0] as { body: Record<string, unknown> })
			.body;
		// The observed endpoint takes the server fields and the recipient
		// flattened into one JSON body, with the email normalized.
		expect(body).toMatchObject({
			host: "mailpit",
			port: 1025,
			email: "Reader@example.com",
		});
	});

	test("registers the send with create-class safety", () => {
		const operation = settingsOperations[1];
		expect(operation?.id).toBe("settings.test-smtp");
		expect(operation?.safety).toEqual({
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: true,
		});
	});

	test("rejects a non-array log payload as a loud mismatch", async () => {
		const testSmtp = mock(async () => ({ data: true }));
		await expect(
			invokeTestSmtpOperation(
				settingsContext({
					testSmtp: testSmtp as unknown as SettingsClient["settings"]["testSmtp"],
				}),
				{ email: "r@example.com", server: { host: "mailpit", port: 1025 } },
			),
		).rejects.toThrow("unexpected response payload");
	});

	test("rejects an invalid recipient before any request", async () => {
		const testSmtp = mock(async () => ({ data: [] }));
		await expect(
			invokeTestSmtpOperation(
				settingsContext({
					testSmtp: testSmtp as unknown as SettingsClient["settings"]["testSmtp"],
				}),
				{ email: "not-an-email", server: { host: "mailpit", port: 1025 } },
			),
		).rejects.toThrow();
		expect(testSmtp).not.toHaveBeenCalled();
	});
});
