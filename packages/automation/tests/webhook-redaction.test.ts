import { describe, expect, test } from "bun:test";
import {
	containsEmailAddress,
	isSensitiveWebhookDataKey,
} from "../src/webhook-redaction";

describe("webhook payload key classification", () => {
	test("matches credential and personal-data words in plural and cased spellings", () => {
		for (const key of [
			"email",
			"emails",
			"EMAIL",
			"e-mail",
			"eMail",
			"subscriberEmails",
			"subscriber_emails",
			"email_address",
			"emailAddresses",
			"recipient",
			"recipients",
			"bouncedRecipients",
			"recipient-list",
			"rcpt_to",
			"token",
			"tokens",
			"refreshTokens",
			"refresh_tokens",
			"access-token",
			"secret",
			"secrets",
			"clientSecret",
			"password",
			"passwords",
			"pass_word",
			"passwd",
			"cookie",
			"cookies",
			"Set-Cookie",
			"apiKey",
			"apiKeys",
			"APIKeys",
			"api_key",
			"X-Api-Key",
			"apikeys",
			"authorization",
			"Proxy-Authorization",
			"credentials",
		]) {
			expect({ key, sensitive: isSensitiveWebhookDataKey(key) }).toEqual({
				key,
				sensitive: true,
			});
		}
	});

	test("matches recipient header and envelope fields only as whole key segments", () => {
		for (const key of [
			"to",
			"To",
			"from",
			"cc",
			"bcc",
			"replyTo",
			"Reply-To",
			"sender",
			"source",
			"destination",
			"destinations",
			"returnPath",
			"Delivered-To",
			"mail.source",
			"commonHeaders.to",
		]) {
			expect({ key, sensitive: isSensitiveWebhookDataKey(key) }).toEqual({
				key,
				sensitive: true,
			});
		}
		for (const key of [
			"from_status",
			"to_status",
			"sourceIp",
			"source_arn",
			"destination_count_total",
			"commonHeaders",
			"mail",
		]) {
			expect({ key, sensitive: isSensitiveWebhookDataKey(key) }).toEqual({
				key,
				sensitive: false,
			});
		}
	});

	test("keeps ordinary operational keys visible", () => {
		for (const key of [
			"status",
			"messageId",
			"message_id",
			"provider_event_id",
			"subscriber_uuid",
			"campaign_id",
			"bounceType",
			"diagnosticCode",
			"subject",
			"tokenizer",
			"secretary",
			"passwordless",
			"surface",
			"dry_run",
			"",
		]) {
			expect({ key, sensitive: isSensitiveWebhookDataKey(key) }).toEqual({
				key,
				sensitive: false,
			});
		}
	});
});

describe("email-address value detection", () => {
	test("finds plain, display-name, encoded, and internationalized addresses", () => {
		for (const value of [
			"jane@example.com",
			"Jane Doe <jane.doe+news@example.co.uk>",
			'"Jane Doe"@example.com',
			"smtp; 550 5.1.1 <jane@example.com>: Recipient address rejected",
			"https://example.com/unsubscribe?email=jane%40example.com",
			"arn:aws:ses:us-east-1:123456789012:identity/sender@example.com",
			"JANE@EXAMPLE.COM.",
			"josé@exämple.de",
			"a@b@example.org",
		]) {
			expect({ value, email: containsEmailAddress(value) }).toEqual({
				value,
				email: true,
			});
		}
	});

	test("ignores values that are not addresses", () => {
		for (const value of [
			"",
			"@",
			"@example.com",
			"contact @example.com",
			"user@localhost",
			"user@.com",
			"user@example.",
			"zod@4.6.5",
			"postgres://listmonk:listmonk@127.0.0.1:15432/listmonk",
			"100%40 sure",
			"50%",
			"campaign.started",
		]) {
			expect({ value, email: containsEmailAddress(value) }).toEqual({
				value,
				email: false,
			});
		}
	});

	test("stays linear on adversarial input", () => {
		const inputs = [
			"a@".repeat(200_000),
			`${"a".repeat(400_000)}@`,
			`a@${"1.".repeat(200_000)}`,
			`a@1.${"2".repeat(400_000)}`,
			`a@${"b".repeat(400_000)}`,
			"%40".repeat(150_000),
			"a.".repeat(200_000),
		];
		const startedAt = performance.now();
		for (const input of inputs) {
			expect(containsEmailAddress(input)).toBe(false);
		}
		expect(containsEmailAddress(`${"a@".repeat(100_000)}x@example.com`)).toBe(
			true,
		);
		expect(performance.now() - startedAt).toBeLessThan(1_000);
	});
});
