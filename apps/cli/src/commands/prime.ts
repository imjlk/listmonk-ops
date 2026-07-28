import { invokeControlPrimeOperation } from "@listmonk-ops/operations";
import { z } from "zod";
import { cliOperationCatalog } from "../operation-catalog";
import { defineCommand, option } from "../lib/command";
import { getOutput } from "../lib/output";

export default defineCommand({
	name: "prime",
	description: "Prime an AI agent with goal-oriented operation guidance",
	operationId: "control.prime",
	options: {
		goal: option(z.string().trim().min(1).optional(), {
			description: "Optional email operations goal",
		}),
		limit: option(z.coerce.number().int().min(1).max(20).default(8), {
			description: "Maximum recommended operations",
		}),
	},
	handler: async ({ flags }) => {
		getOutput().json(
			await invokeControlPrimeOperation(
				{ catalog: cliOperationCatalog },
				flags,
			),
		);
	},
});
