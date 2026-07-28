import { invokeControlCapabilitiesOperation } from "@listmonk-ops/operations";
import { cliOperationCatalog } from "../operation-catalog";
import { defineCommand } from "../lib/command";
import { getOutput } from "../lib/output";

export default defineCommand({
	name: "capabilities",
	description: "Summarize operation families and typed spec coverage",
	operationId: "control.capabilities",
	handler: async () => {
		getOutput().json(
			await invokeControlCapabilitiesOperation(
				{ catalog: cliOperationCatalog },
				{},
			),
		);
	},
});
