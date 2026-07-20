import { describe, expect, test } from "bun:test";
import { cli } from "gunshi";
import { z } from "zod";
import { defineCommand, option, prepareCliArgv } from "../src/lib/command";

describe("CLI command adapter", () => {
	test("recognizes optional boolean schemas as boolean arguments", async () => {
		let capturedFlags: Record<string, unknown> | undefined;
		const command = defineCommand({
			name: "probe",
			options: {
				verbose: option(z.boolean().optional()),
			},
			handler: ({ flags }) => {
				capturedFlags = flags;
			},
		});

		expect(command.args?.verbose).toMatchObject({ type: "boolean" });
		await cli(prepareCliArgv(["--verbose"]), command, {
			name: "probe",
			usageSilent: true,
		});

		expect(capturedFlags?.verbose).toBe(true);
	});

	test("preserves intercepted global flags over command defaults", async () => {
		let capturedFlags: Record<string, unknown> | undefined;
		const command = defineCommand({
			name: "probe",
			options: {
				interactive: option(z.boolean().default(false)),
			},
			handler: ({ flags }) => {
				capturedFlags = flags;
			},
		});

		await cli(prepareCliArgv(["--interactive"]), command, {
			name: "probe",
			usageSilent: true,
		});

		expect(capturedFlags?.interactive).toBe(true);
	});
});
