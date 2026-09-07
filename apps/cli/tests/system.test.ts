import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import {
	renderSystemAbout,
	renderSystemReload,
	renderSystemLogs,
	type SystemCliContext,
} from "../src/commands/system";

function output() {
	return {
		info: mock(() => undefined),
		json: mock(() => undefined),
		success: mock(() => undefined),
		table: mock(() => undefined),
		warning: mock(() => undefined),
	};
}

describe("system CLI actions", () => {
	test("renders the build identity through the shared operation", async () => {
		const getAbout = mock(async () => ({
			data: { version: "v6.2.0", build: "v6.2.0 (ef0a7587)" },
		}));
		const cliContext = {
			client: { system: { getAbout } } as unknown as Pick<
				ListmonkClient,
				"system"
			>,
			output: output(),
		} satisfies SystemCliContext;

		await renderSystemAbout(cliContext);

		expect(cliContext.output.success).toHaveBeenCalledWith(
			"Listmonk v6.2.0 build identity",
		);
		expect(cliContext.output.json).toHaveBeenCalledWith({
			version: "v6.2.0",
			build: "v6.2.0 (ef0a7587)",
		});
	});

	test("renders the reload acknowledgement", async () => {
		const reload = mock(async () => ({ data: true }));
		const cliContext = {
			client: { system: { reload } } as unknown as Pick<
				ListmonkClient,
				"system"
			>,
			output: output(),
		} satisfies SystemCliContext;

		await import("../src/commands/system").then((m) =>
			m.renderSystemReload(cliContext),
		);
		expect(cliContext.output.success).toHaveBeenCalledWith(
			"Listmonk app configuration reloaded",
		);
		expect(cliContext.output.json).toHaveBeenCalledWith({ reloaded: true });
	});

	test("renders and tail-selects server logs", async () => {
		const getLogs = mock(async () => ({
			data: ["line one", "line two", "line three"],
		}));
		const cliContext = {
			client: { system: { getLogs } } as unknown as Pick<
				ListmonkClient,
				"system"
			>,
			output: output(),
		} satisfies SystemCliContext;

		await renderSystemLogs(cliContext, { lines: 2 });
		expect(cliContext.output.json).toHaveBeenCalledWith({
			logs: ["line two", "line three"],
		});

		await renderSystemLogs(cliContext, {});
		expect(cliContext.output.json).toHaveBeenCalledWith({
			logs: ["line one", "line two", "line three"],
		});
	});
});
