import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import {
	renderSettings,
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
		});
	});
});
