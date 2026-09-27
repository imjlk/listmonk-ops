import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import {
	invokeTestSmtpOperation,
	redactSettingsCredentials,
	redactUrlCredentials,
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

/**
 * The same 6.2 document with credentials embedded in URL values, which GET
 * /api/settings returns verbatim: a staging root URL behind basic auth, an
 * Azure SAS logo link, a trusted redirect carrying a token, a presigned S3
 * public URL, an SMS postback URL with basic auth and an API key, and SMTP
 * and POP URLs pasted into `host` fields in the form other mailers accept.
 */
function listmonk62SettingsDocumentWithUrlCredentials() {
	const document = listmonk62SettingsDocument();
	const [postmark, ses] = document.smtp;
	const [mailbox] = document["bounce.mailboxes"];
	const [messenger] = document.messengers;
	return {
		...document,
		"app.root_url": "https://stage-user:stage-basic-pass@lists.example.com",
		"app.logo_url":
			"https://media.blob.core.windows.net/brand/logo.png?sv=2024-11-04&sp=r&sig=azure-sas-signature",
		"security.trusted_urls": [
			"https://example.com/thanks?token=trusted-redirect-token",
			"https://example.com/welcome",
		],
		"upload.s3.public_url":
			"https://cdn.example.com/listmonk-media?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20260927%2Fap-northeast-2%2Fs3%2Faws4_request&X-Amz-Signature=s3-presign-signature",
		smtp: [
			postmark!,
			ses!,
			{
				...postmark!,
				name: "email-relay",
				uuid: "7d1e4c2b-9a8f-4e6d-b5c4-3a2f1e0d9c8b",
				enabled: false,
				host: "smtps://relay-user:relay-pass@smtp.relay.example.com:465",
			},
		],
		messengers: [
			{
				...messenger!,
				root_url:
					"https://gw-user:gw-pass@sms.example.com/listmonk?api_key=sms-api-key&channel=sms",
			},
		],
		"bounce.mailboxes": [
			{
				...mailbox!,
				host: "pop3s://bounce-user:bounce-pass@pop.example.com:995",
			},
		],
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

describe("settings URL credential redaction", () => {
	test("redacts credentials embedded in the 6.2 document's URL values", async () => {
		const document = listmonk62SettingsDocumentWithUrlCredentials();
		const get = mock(async () => ({ data: document }));

		const { settings } = await invokeGetSettingsOperation(
			settingsContext({
				get: get as unknown as SettingsClient["settings"]["get"],
			}),
			{},
		);
		const redacted = settings as ReturnType<
			typeof listmonk62SettingsDocumentWithUrlCredentials
		>;

		const embeddedCredentials = [
			"stage-user",
			"stage-basic-pass",
			"azure-sas-signature",
			"trusted-redirect-token",
			"AKIAIOSFODNN7EXAMPLE",
			"s3-presign-signature",
			"relay-user",
			"relay-pass",
			"gw-user",
			"gw-pass",
			"sms-api-key",
			"bounce-user",
			"bounce-pass",
		];
		const serialized = JSON.stringify(redacted);
		for (const credential of embeddedCredentials) {
			expect(serialized).not.toContain(credential);
		}

		// Scheme, host, port, path, and the other parameters stay visible.
		expect(redacted["app.root_url"]).toBe(
			`https://${SETTINGS_REDACTED_VALUE}@lists.example.com`,
		);
		expect(redacted["app.logo_url"]).toBe(
			`https://media.blob.core.windows.net/brand/logo.png?sv=2024-11-04&sp=r&sig=${SETTINGS_REDACTED_VALUE}`,
		);
		expect(redacted["security.trusted_urls"]).toEqual([
			`https://example.com/thanks?token=${SETTINGS_REDACTED_VALUE}`,
			"https://example.com/welcome",
		]);
		expect(redacted["upload.s3.public_url"]).toBe(
			`https://cdn.example.com/listmonk-media?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${SETTINGS_REDACTED_VALUE}&X-Amz-Signature=${SETTINGS_REDACTED_VALUE}`,
		);
		expect(redacted.smtp[2]?.host).toBe(
			`smtps://${SETTINGS_REDACTED_VALUE}@smtp.relay.example.com:465`,
		);
		expect(redacted.messengers[0]?.root_url).toBe(
			`https://${SETTINGS_REDACTED_VALUE}@sms.example.com/listmonk?api_key=${SETTINGS_REDACTED_VALUE}&channel=sms`,
		);
		expect(redacted["bounce.mailboxes"][0]?.host).toBe(
			`pop3s://${SETTINGS_REDACTED_VALUE}@pop.example.com:995`,
		);

		// URLs without credentials and non-URL strings are untouched.
		expect(redacted["upload.s3.url"]).toBe(
			"https://s3.ap-northeast-2.amazonaws.com",
		);
		expect(redacted["security.oidc"].provider_url).toBe(
			"https://id.example.com",
		);
		expect(redacted["app.from_email"]).toBe("listmonk <noreply@example.com>");
		expect(redacted.smtp[0]?.host).toBe("smtp.postmarkapp.com");
		expect(redacted["bounce.mailboxes"][0]?.return_path).toBe(
			"bounces@example.com",
		);
		expect(redacted["maintenance.db"].vacuum_cron_interval).toBe("0 2 * * *");
		// The source document keeps its original values.
		expect(document.messengers[0]?.root_url).toContain("gw-pass");
	});

	test("redacts credential-named query parameters and keeps every other string", () => {
		const cases: ReadonlyArray<readonly [string, string]> = [
			[
				"https://sms.example.com/send?apiKey=a&X-Api-Key=b&access-token=c&page=2",
				"https://sms.example.com/send?apiKey=[redacted]&X-Api-Key=[redacted]&access-token=[redacted]&page=2",
			],
			[
				"https://sms.example.com/send?user=alice&pass=b&pwd=c&username=d&password=e&to=%2B15550100",
				"https://sms.example.com/send?user=[redacted]&pass=[redacted]&pwd=[redacted]&username=[redacted]&password=[redacted]&to=%2B15550100",
			],
			[
				"https://hooks.example.com/in?key=a&secret=b&client_secret=c&auth=d&jwt=e&session_id=f&utm_source=listmonk",
				"https://hooks.example.com/in?key=[redacted]&secret=[redacted]&client_secret=[redacted]&auth=[redacted]&jwt=[redacted]&session_id=[redacted]&utm_source=listmonk",
			],
			[
				"https://bucket.s3.amazonaws.com/a.png?X-Amz-Date=20260927T000000Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Security-Token=a&X-Amz-Signature=b",
				"https://bucket.s3.amazonaws.com/a.png?X-Amz-Date=20260927T000000Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Security-Token=[redacted]&X-Amz-Signature=[redacted]",
			],
			[
				"https://cdn.example.com/a.png?Expires=1798761600&Signature=a&Key-Pair-Id=b",
				"https://cdn.example.com/a.png?Expires=1798761600&Signature=[redacted]&Key-Pair-Id=[redacted]",
			],
			[
				"https://example.test/?token=https://secret.example/path",
				"https://example.test/?token=[redacted]",
			],
			[
				"https://sms.example/send?token=correct horse battery&to=1",
				"https://sms.example/send?token=[redacted]&to=1",
			],
			[
				"https://x.example/?token=a b&api_key=c d",
				"https://x.example/?token=[redacted]&api_key=[redacted]",
			],
			[
				"bounces@in.forwardemail.net?token=correct horse battery&to=1",
				"bounces@in.forwardemail.net?token=[redacted]&to=1",
			],
			[
				"?token=correct horse&to=1 https://fallback.example/x",
				"?token=[redacted]&to=1 https://fallback.example/x",
			],
			// Percent-encoded names and the legacy ";" separator still match.
			[
				"https://hooks.example.com/in?q=a;%74oken=b",
				"https://hooks.example.com/in?q=a;%74oken=[redacted]",
			],
			// Only the URL is rewritten; the text around it is kept.
			[
				"  https://user:pass@hooks.example.com/in  trailing note",
				"  https://[redacted]@hooks.example.com/in  trailing note",
			],
		];
		const unchanged = [
			"HTTPS://Lists.Example.com/Path?page=2&keyword=news#Top",
			"https://cdn.jsdelivr.net/npm/@listmonk/logo.png",
			"https://hooks.example.com/in?token=",
			"mailto:ops@example.com?subject=token",
			"listmonk <noreply@example.com>",
			"bounces@example.com",
			"smtp.example.com",
			"mailpit:1025",
			"a:hover { color: red }",
			"https://example.com is the site; write to ops@example.com",
			"0 2 * * *",
			"",
		];

		const redacted = redactSettingsCredentials({
			"security.trusted_urls": [
				...cases.map(([input]) => input),
				...unchanged,
			],
		}) as { "security.trusted_urls": string[] };

		expect(redacted["security.trusted_urls"]).toEqual([
			...cases.map(([, expected]) => expected),
			...unchanged,
		]);
	});

	test("redacts the userinfo of URLs the parser rejects", () => {
		expect(
			redactSettingsCredentials({
				messengers: [
					// A mistyped port.
					{ root_url: "https://gw-user:gw-pass@sms.example.com:80a/send?token=t" },
					// An unencoded "/" in the password ends the authority early.
					{ root_url: "https://gw-user:gw/pass@sms.example.com/send" },
					{ root_url: "https://sms.example.com:99999/send?api_key=k&to=1" },
				],
			}),
		).toEqual({
			messengers: [
				{
					root_url: `https://${SETTINGS_REDACTED_VALUE}@sms.example.com:80a/send?token=${SETTINGS_REDACTED_VALUE}`,
				},
				{
					root_url: `https://${SETTINGS_REDACTED_VALUE}@sms.example.com/send`,
				},
				{
					root_url: `https://sms.example.com:99999/send?api_key=${SETTINGS_REDACTED_VALUE}&to=1`,
				},
			],
		});
	});

	test("redacts spaced userinfo, every URL in a value, and fragment credentials", () => {
		const cases: ReadonlyArray<readonly [string, string]> = [
			// A passphrase typed into the userinfo without encoding its spaces.
			[
				"https://gw-user:correct horse battery@sms.example.com/send?token=t",
				`https://${SETTINGS_REDACTED_VALUE}@sms.example.com/send?token=${SETTINGS_REDACTED_VALUE}`,
			],
			// A second URL after a credential-free first one.
			[
				"https://a.example.com https://user:secret@b.example.com/cb?token=t",
				`https://a.example.com https://${SETTINGS_REDACTED_VALUE}@b.example.com/cb?token=${SETTINGS_REDACTED_VALUE}`,
			],
			// A parameter-shaped fragment and a client-side route's query.
			[
				"https://id.example.com/cb#access_token=eyJ.abc&state=xyz",
				`https://id.example.com/cb#access_token=${SETTINGS_REDACTED_VALUE}&state=xyz`,
			],
			[
				"https://app.example.com/#/welcome?token=abc&tab=1",
				`https://app.example.com/#/welcome?token=${SETTINGS_REDACTED_VALUE}&tab=1`,
			],
		];
		for (const [input, expected] of cases) {
			expect(redactUrlCredentials(input)).toBe(expected);
			expect(redactUrlCredentials(expected)).toBe(expected);
		}
		// A URL that parses on its own is complete, so the words after it
		// stay prose even when one of them contains "@".
		for (const text of [
			"http://listmonk:9000 contact ops@example.com",
			"https://docs.example.com/guide#section-2",
		]) {
			expect(redactUrlCredentials(text)).toBe(text);
		}
	});

	test("redacts URLs embedded in punctuation and preserves their wrappers", () => {
		const cases: ReadonlyArray<readonly [string, string]> = [
			[
				"appearance.css=background:url(https://user:pass@cdn.example/x?token=secret)",
				`appearance.css=background:url(https://${SETTINGS_REDACTED_VALUE}@cdn.example/x?token=${SETTINGS_REDACTED_VALUE})`,
			],
			[
				'"https://user:pass@cdn.example/x?AWSAccessKeyId=AKIAIOSFODNN7EXAMPLE"',
				`"https://${SETTINGS_REDACTED_VALUE}@cdn.example/x?AWSAccessKeyId=${SETTINGS_REDACTED_VALUE}"`,
			],
			[
				"background:url(https://cdn.example/x?AWSAccessKeyId=AKIAIOSFODNN7EXAMPLE),",
				`background:url(https://cdn.example/x?AWSAccessKeyId=${SETTINGS_REDACTED_VALUE}),`,
			],
			[
				"background:url(https://cdn.example/x?token=secret);color:red",
				`background:url(https://cdn.example/x?token=${SETTINGS_REDACTED_VALUE});color:red`,
			],
		];
		for (const [input, expected] of cases) {
			expect(redactUrlCredentials(input)).toBe(expected);
			expect(redactUrlCredentials(expected)).toBe(expected);
		}
	});

	test("redacts passphrases with delimiters or a leading port and every fragment parameter", () => {
		const cases: ReadonlyArray<readonly [string, string]> = [
			// "/", "?", and "#" inside a spaced passphrase.
			[
				"https://gw-user:correct horse/battery@sms.example.com/",
				`https://${SETTINGS_REDACTED_VALUE}@sms.example.com/`,
			],
			[
				"https://gw-user:correct horse?battery#staple@sms.example.com/send?token=t",
				`https://${SETTINGS_REDACTED_VALUE}@sms.example.com/send?token=${SETTINGS_REDACTED_VALUE}`,
			],
			// A passphrase whose first word reads as a port.
			[
				"https://gw-user:8080 horse@sms.example.com/send",
				`https://${SETTINGS_REDACTED_VALUE}@sms.example.com/send`,
			],
			[
				"https://gw-user:8080 correct horse@sms.example.com/send",
				`https://${SETTINGS_REDACTED_VALUE}@sms.example.com/send`,
			],
			[
				"https://gw-user:8080 correct horse battery@sms.example.com/send",
				`https://${SETTINGS_REDACTED_VALUE}@sms.example.com/send`,
			],
			// Fragment parameters before a "?".
			[
				"https://id.example.com/cb#access_token=eyJ.abc&state=/home?next=1",
				`https://id.example.com/cb#access_token=${SETTINGS_REDACTED_VALUE}&state=/home?next=1`,
			],
			[
				"https://id.example.com/cb#access_token=ab?cd",
				`https://id.example.com/cb#access_token=${SETTINGS_REDACTED_VALUE}`,
			],
		];
		for (const [input, expected] of cases) {
			expect(redactUrlCredentials(input)).toBe(expected);
			expect(redactUrlCredentials(expected)).toBe(expected);
		}
		// The join is bounded, so text long after a broken URL stays intact.
		const note = "https://listmonk:900x a b c d e f g h i ops@example.com";
		expect(redactUrlCredentials(note)).toBe(note);
	});

	test("redacts credential parameters nested in other values", () => {
		const cases: ReadonlyArray<readonly [string, string]> = [
			// A "/" after a port-like first word of a spaced passphrase.
			[
				"https://gw-user:8080 horse/battery@sms.example.com/send",
				`https://${SETTINGS_REDACTED_VALUE}@sms.example.com/send`,
			],
			// A credential parameter after a "?" inside another value.
			[
				"https://id.example.com/cb#state=/home?token=abc",
				`https://id.example.com/cb#state=/home?token=${SETTINGS_REDACTED_VALUE}`,
			],
			[
				"https://app.example.com/login?next=/dashboard?token=abc&page=2",
				`https://app.example.com/login?next=/dashboard?token=${SETTINGS_REDACTED_VALUE}&page=2`,
			],
		];
		for (const [input, expected] of cases) {
			expect(redactUrlCredentials(input)).toBe(expected);
			expect(redactUrlCredentials(expected)).toBe(expected);
		}
		const nested = "https://app.example.com/login?next=/dashboard?tab=2&page=2";
		expect(redactUrlCredentials(nested)).toBe(nested);
	});

	test("keeps everything but the redacted parts as written", () => {
		expect(
			redactUrlCredentials("HTTPS://User:Pass@Lists.Example.com:443/Path"),
		).toBe(`HTTPS://${SETTINGS_REDACTED_VALUE}@Lists.Example.com:443/Path`);
		expect(redactUrlCredentials("https://Example.com:443/#access_token=x")).toBe(
			`https://Example.com:443/#access_token=${SETTINGS_REDACTED_VALUE}`,
		);
		expect(
			redactUrlCredentials("https:\\\\user:pass@host.example.com\\x?key=k"),
		).toBe(
			`https:\\\\${SETTINGS_REDACTED_VALUE}@host.example.com\\x?key=${SETTINGS_REDACTED_VALUE}`,
		);
	});

	test("rewrites only URLs with credentials and is idempotent", () => {
		const verbatim = "HTTPS://Lists.Example.com:8443/a//b?page=2#Top";
		expect(redactUrlCredentials(verbatim)).toBe(verbatim);

		const once = redactUrlCredentials(
			"redis://:cache-pass@cache.example.com:6379/0?password=cache-pass",
		);
		expect(once).toBe(
			`redis://${SETTINGS_REDACTED_VALUE}@cache.example.com:6379/0?password=${SETTINGS_REDACTED_VALUE}`,
		);
		expect(redactUrlCredentials(once)).toBe(once);

		const document = listmonk62SettingsDocumentWithUrlCredentials();
		const redactedOnce = redactSettingsCredentials(document);
		expect(redactSettingsCredentials(redactedOnce)).toEqual(redactedOnce);
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
