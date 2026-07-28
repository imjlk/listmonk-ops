import {
	invokeSpecDescribeOperation,
	invokeSpecSearchOperation,
} from "@listmonk-ops/operations";
import { z } from "zod";
import { cliOperationCatalog } from "../operation-catalog";
import { defineCommand, defineGroup, option } from "../lib/command";
import { getOutput } from "../lib/output";

const searchCommand = defineCommand({
	name: "search",
	description: "Search typed operation contracts by intent",
	operationId: "specs.search",
	options: {
		query: option(z.string().trim().min(1), {
			description: "Operational intent or keyword query",
		}),
		family: option(z.string().trim().min(1).optional(), {
			description: "Optional exact operation family",
		}),
		resource: option(z.string().trim().min(1).optional(), {
			description: "Optional typed resource filter",
		}),
		verb: option(z.string().trim().min(1).optional(), {
			description: "Optional operation verb filter",
		}),
		limit: option(z.coerce.number().int().min(1).max(100).default(20), {
			description: "Maximum search results",
		}),
	},
	handler: async ({ flags }) => {
		getOutput().json(
			await invokeSpecSearchOperation(
				{ catalog: cliOperationCatalog },
				flags,
			),
		);
	},
});

const describeCommand = defineCommand({
	name: "describe",
	description: "Describe one operation contract and agent policy",
	operationId: "specs.describe",
	options: {
		operation: option(z.string().trim().min(1), {
			description: "Operation ID or MCP tool name",
		}),
	},
	handler: async ({ flags }) => {
		getOutput().json(
			await invokeSpecDescribeOperation(
				{ catalog: cliOperationCatalog },
				flags,
			),
		);
	},
});

export default defineGroup({
	name: "specs",
	description: "Discover typed email operation specifications",
	commands: [searchCommand, describeCommand],
});
