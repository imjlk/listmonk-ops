import type { ListmonkClient } from "@listmonk-ops/openapi";
import { RedactedSettingsPlaceholderError } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import {
	renderSettings,
	renderTestSmtp,
	type SettingsCliContext,
} from "../src/commands/settings";

function output() {
	return {
		info: mock(() => undefined),
		json: mock(() => undefined),
		success: mock(() => undefined),
		table: mock(() => undefined),
		warning: mock(() => undefined),
	};
}

describe("settings CLI actions", () => {
	test("renders the redacted settings document", async () => {
		const get = mock(async () => ({
			data: {
				"app.site_name": "Mailing list",
				"bounce.sendgrid_key": "SG.secret",
				messengers: [
					{
						name: "sms-gateway",
						root_url:
							"https://gw-user:gw-pass@sms.example.com/listmonk?api_key=sms-api-key&channel=sms",
					},
				],
			},
		}));
		const cliContext = {
			client: { settings: { get } } as unknown as Pick<
				ListmonkClient,
				"settings"
			>,
			output: output(),
		} satisfies SettingsCliContext;

		await renderSettings(cliContext);

		expect(cliContext.output.json).toHaveBeenCalledWith({
			"app.site_name": "Mailing list",
			"bounce.sendgrid_key": "[redacted]",
			messengers: [
				{
					name: "sms-gateway",
					root_url:
						"https://[redacted]@sms.example.com/listmonk?api_key=[redacted]&channel=sms",
				},
			],
		});
	});

	test("refuses to test SMTP with a server copied from the redacted read", async () => {
		const get = mock(async () => ({
			data: {
				smtp: [
					{
						name: "email-postmark",
						uuid: "2e8c0f4a-2f6b-4a55-9f1e-7d3c2b1a0e9f",
						enabled: true,
						host: "smtp.postmarkapp.com",
						port: 587,
						auth_protocol: "plain",
						username: "pm-server-token-7c1d",
						password: "••••••••••••••••••••",
						tls_type: "STARTTLS",
					},
				],
			},
		}));
		const testSmtp = mock(async () => ({ data: ["sent"] }));
		const cliContext = {
			client: { settings: { get, testSmtp } } as unknown as Pick<
				ListmonkClient,
				"settings"
			>,
			output: output(),
		} satisfies SettingsCliContext;

		await renderSettings(cliContext);
		const [{ smtp }] = cliContext.output.json.mock.calls[0] as unknown as [
			{ smtp: Array<Parameters<typeof renderTestSmtp>[1]["server"]> },
		];
		const server = smtp[0];
		if (server === undefined) throw new Error("Expected a redacted SMTP server");

		await expect(
			renderTestSmtp(cliContext, { email: "ops@example.com", server }),
		).rejects.toThrow(
			new RedactedSettingsPlaceholderError("test SMTP", [
				"server.username",
				"server.password",
			]).message,
		);
		expect(testSmtp).not.toHaveBeenCalled();
		expect(cliContext.output.success).toHaveBeenCalledTimes(1);
	});
});
