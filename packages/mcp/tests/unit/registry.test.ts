import { describe, expect, test } from "bun:test";
import {
	allTools,
	assertUniqueToolNames,
	toolNameSets,
	toolRegistrations,
} from "../../src/handlers/index.js";

describe("MCP tool registry", () => {
	test("registers every tool exactly once", () => {
		const registeredTools = toolRegistrations.flatMap(
			(registration) => registration.tools,
		);

		expect(registeredTools).toHaveLength(allTools.length);
		expect(new Set(allTools.map((tool) => tool.name)).size).toBe(
			allTools.length,
		);
		expect(allTools.length).toBe(64);
	});

	test("keeps tool-name matching exact", () => {
		expect(toolNameSets.campaigns.has("listmonk_get_campaigns")).toBe(true);
		expect(toolNameSets.campaigns.has("listmonk_get_campaigns_extra")).toBe(
			false,
		);
		expect(toolNameSets.settings.has("listmonk_get_settings_extra")).toBe(
			false,
		);
		expect(toolNameSets.catalog.has("listmonk_list_operations")).toBe(true);
	});

	test("rejects duplicate registrations", () => {
		const firstTool = allTools[0];
		expect(firstTool).toBeDefined();
		if (!firstTool) {
			return;
		}

		expect(() => assertUniqueToolNames([firstTool, firstTool])).toThrow(
			`Duplicate MCP tool names: ${firstTool.name}`,
		);
	});
});
