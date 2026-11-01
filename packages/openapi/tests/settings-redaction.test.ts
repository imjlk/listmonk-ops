import { describe, expect, test } from "bun:test";
import {
	assertNoRedactedSettingsPlaceholders,
	findRedactedSettingsPlaceholderPaths,
	hasRedactedSettingsPlaceholder,
	RedactedSettingsPlaceholderError,
	type RedactedSettingsWrite,
	SETTINGS_REDACTED_VALUE,
} from "../src/client/settings-redaction";

function placeholderError(
	document: unknown,
	write: RedactedSettingsWrite,
): RedactedSettingsPlaceholderError {
	try {
		assertNoRedactedSettingsPlaceholders(document, write);
	} catch (error) {
		if (error instanceof RedactedSettingsPlaceholderError) return error;
		throw error;
	}
	throw new Error("Expected the document to be rejected");
}

describe("settings write placeholder guard", () => {
	test("names a whole-value placeholder by its key path", () => {
		expect(
			findRedactedSettingsPlaceholderPaths({
				"app.site_name": "Mailing list",
				"bounce.sendgrid_key": SETTINGS_REDACTED_VALUE,
			}),
		).toEqual(["bounce.sendgrid_key"]);
	});

	test("finds a placeholder in URL userinfo", () => {
		for (const url of [
			"https://[redacted]@lists.example.com",
			"smtps://relay-user:[redacted]@smtp.relay.example.com:465",
			"https:\\\\[redacted]@lists.example.com",
			"https://app.example.com/login?next=https%3A%2F%2F%5Bredacted%5D%40inner.example.com",
		]) {
			expect(hasRedactedSettingsPlaceholder(url)).toBe(true);
			expect(findRedactedSettingsPlaceholderPaths({ "app.root_url": url })).toEqual(
				["app.root_url"],
			);
		}
	});

	test("finds a placeholder in a credential query, fragment, or free-text parameter", () => {
		for (const value of [
			"https://media.example.com/logo.png?sv=2024-11-04&sp=r&sig=[redacted]",
			"https://example.com/thanks?token=[redacted]&utm_source=mail",
			"https://example.com/#access_token=[redacted]",
			"token=[redacted]&channel=sms",
			"https://app.example.com/cb?redirect=https%3A%2F%2Fhost%2Fcb%3Ftoken%3D%5Bredacted%5D",
			// The redactor reads a raw parameter name through an encoded
			// separator ("sig%26" decodes to "sig&") and, inside a query, through
			// a "?" ("token?"), so the guard must read them the same way.
			"https://example.com/?sig%26=[redacted]",
			"https://example.com/p?x=1&token?=[redacted]",
		]) {
			expect(hasRedactedSettingsPlaceholder(value)).toBe(true);
		}
	});

	test("keeps reading encoded text after characters that lowercase longer", () => {
		// "İ" lowercases to two code units. The encoded assignment must still
		// be found before the marker after three decoding passes.
		const shifted = "İİİ?token%2525253D[redacted]";
		expect(hasRedactedSettingsPlaceholder(shifted.slice(3))).toBe(true);
		expect(hasRedactedSettingsPlaceholder(shifted)).toBe(true);
	});

	test("walks nested arrays and objects in document order", () => {
		const document = {
			"app.site_name": "Mailing list",
			"security.oidc": {
				client_id: "listmonk-public-client",
				client_secret: SETTINGS_REDACTED_VALUE,
			},
			"security.trusted_urls": [
				"https://example.com/welcome",
				"https://example.com/thanks?token=[redacted]",
			],
			smtp: [
				{
					uuid: "2e8c0f4a-2f6b-4a55-9f1e-7d3c2b1a0e9f",
					host: "smtp.example.com",
					username: SETTINGS_REDACTED_VALUE,
					password: SETTINGS_REDACTED_VALUE,
					email_headers: [{ "X-PM-Message-Stream": "broadcast" }],
				},
				{ host: "smtp.backup.example.com", port: 587 },
			],
			messengers: [
				{
					root_url:
						"https://[redacted]@sms.example.com/listmonk?api_key=[redacted]&channel=sms",
				},
			],
			"legacy notes": { "relay password": SETTINGS_REDACTED_VALUE },
		};

		expect(findRedactedSettingsPlaceholderPaths(document)).toEqual([
			"security.oidc.client_secret",
			"security.trusted_urls[1]",
			"smtp[0].username",
			"smtp[0].password",
			"messengers[0].root_url",
			'["legacy notes"]["relay password"]',
		]);
	});

	test("reads the document as the JSON request body carries it", () => {
		const document = {
			"security.oidc": {
				toJSON: () => ({ client_secret: SETTINGS_REDACTED_VALUE }),
			},
			"app.notify_emails": [undefined, "ops@example.com"],
		};

		expect(findRedactedSettingsPlaceholderPaths(document)).toEqual([
			"security.oidc.client_secret",
		]);
		expect(findRedactedSettingsPlaceholderPaths(SETTINGS_REDACTED_VALUE)).toEqual(
			["(root)"],
		);
	});

	test("passes a clean document through unchanged", () => {
		const document = {
			"app.root_url": "https://lists.example.com",
			"app.logo_url": "https://cdn.example.com/logo.png?label=[redacted]",
			"appearance.admin.custom_css":
				"background:url(https://cdn.example/x?monkey=[redacted]&hockey=[redacted])",
			"appearance.public.custom_css":
				"/* Include the literal [redacted] marker in this documentation example */",
			smtp: [
				{
					uuid: "2e8c0f4a-2f6b-4a55-9f1e-7d3c2b1a0e9f",
					host: "smtp.example.com",
					username: "postmark-server-token",
					password: "",
				},
			],
			"privacy.exportable": ["profile", "subscriptions"],
			"app.batch_size": 1000,
			"bounce.enabled": true,
			"security.oidc": { default_user_role_id: null },
		};
		const snapshot = structuredClone(document);

		expect(findRedactedSettingsPlaceholderPaths(document)).toEqual([]);
		expect(() =>
			assertNoRedactedSettingsPlaceholders(document, "update"),
		).not.toThrow();
		expect(document).toEqual(snapshot);
	});

	test("names the offending keys, never their values, with Listmonk 6.2 update guidance", () => {
		const error = placeholderError(
			{
				"app.root_url": "https://[redacted]@lists.example.com",
				smtp: [
					{
						uuid: "2e8c0f4a-2f6b-4a55-9f1e-7d3c2b1a0e9f",
						host: "smtp.postmarkapp.com",
						username: SETTINGS_REDACTED_VALUE,
						password: SETTINGS_REDACTED_VALUE,
					},
				],
				"security.oidc": { client_secret: SETTINGS_REDACTED_VALUE },
			},
			"update",
		);

		expect(error).toBeInstanceOf(TypeError);
		expect(error.name).toBe("RedactedSettingsPlaceholderError");
		expect(error.write).toBe("update");
		expect(error.paths).toEqual([
			"app.root_url",
			"smtp[0].username",
			"smtp[0].password",
			"security.oidc.client_secret",
		]);
		expect(error.message).toBe(
			'Cannot update settings: app.root_url, smtp[0].username, smtp[0].password, security.oidc.client_secret still hold the "[redacted]" placeholder that redacted settings reads return in place of credentials, so no request was sent. Listmonk would save the placeholder as the real value. Send the real value for app.root_url, smtp[0].username: Listmonk 6.2 saves the whole settings document on update, so leaving a key out resets it instead of keeping the stored value. For smtp[0].password, security.oidc.client_secret, send the real value or an empty string, which keeps the stored secret as long as the entry keeps its stored uuid.',
		);
		for (const value of ["lists.example.com", "smtp.postmarkapp.com", "2e8c0f4a"]) {
			expect(error.message).not.toContain(value);
		}
	});

	test("explains that the SMTP test never falls back to stored credentials", () => {
		const error = placeholderError(
			{
				email: "ops@example.com",
				host: "smtp.postmarkapp.com",
				username: SETTINGS_REDACTED_VALUE,
				password: SETTINGS_REDACTED_VALUE,
			},
			"test SMTP",
		);

		expect(error.paths).toEqual(["username", "password"]);
		expect(error.message).toBe(
			'Cannot test SMTP settings: username, password still hold the "[redacted]" placeholder that redacted settings reads return in place of credentials, so no request was sent. Listmonk\'s SMTP test authenticates only with the credentials in the request and never falls back to the stored ones, so send the real values.',
		);
	});

	test("summarizes a long list of offending keys", () => {
		const error = placeholderError(
			{
				smtp: Array.from({ length: 23 }, () => ({
					password: SETTINGS_REDACTED_VALUE,
				})),
			},
			"update",
		);

		expect(error.paths).toHaveLength(23);
		expect(error.message).toContain(
			"smtp[18].password, smtp[19].password, and 3 more still hold",
		);
	});
});
