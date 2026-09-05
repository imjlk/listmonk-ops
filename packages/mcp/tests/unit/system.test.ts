import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, test } from "bun:test";
import { handleSystemTools, systemTools } from "../../src/handlers/system";
import type { CallToolRequest } from "../../src/types/mcp";

function request(
	name: string,
	arguments_: Record<string, unknown> = {},
): CallToolRequest {
	return {
		method: "tools/call",
		params: { name, arguments: arguments_ },
	};
}

describe("system operation adapter", () => {
	test("publishes the shared read tools", () => {
		expect(systemTools.map((tool) => tool.name)).toEqual([
			"listmonk_get_about",
			"listmonk_get_logs",
		]);
		expect(systemTools[0]?.annotations).toMatchObject({
			readOnlyHint: true,
			destructiveHint: false,
		});
	});

	test("routes reads through the shared operation result adapter", async () => {
		const client = {
			system: {
				getAbout: async () => ({
					data: { version: "v6.2.0", go_arch: "arm64" },
				}),
			},
		} as unknown as ListmonkClient;

		const result = await handleSystemTools(
			request("listmonk_get_about"),
			client,
		);
		expect(result.isError).toBeFalsy();
		expect(result.structuredContent).toEqual({
			version: "v6.2.0",
			go_arch: "arm64",
		});

		const unknown = await handleSystemTools(
			request("listmonk_unknown_system"),
			client,
		);
		expect(unknown.isError).toBe(true);
	});
});
