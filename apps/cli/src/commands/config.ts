import { invokeControlConfigurationOperation } from "@listmonk-ops/operations";
import { defineCommand, defineGroup } from "../lib/command";
import { resolveCliConfiguration } from "../lib/configuration";
import { getOutput } from "../lib/output";

const showCommand = defineCommand({
	name: "show",
	description: "Show profile names, resolved connection sources, and credential references without secrets",
	operationId: "control.config",
	handler: async () => {
		const resolved = await resolveCliConfiguration();
		getOutput().json(
			await invokeControlConfigurationOperation({ configuration: resolved.summary }, {}),
		);
	},
});

export default defineGroup({
	name: "config",
	description: "Inspect shared connection profiles and configuration",
	commands: [showCommand],
});
