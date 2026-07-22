import { OutputUtils } from "@listmonk-ops/common";
import { z } from "zod";
import { listCliOperationCatalogSummaries } from "../operation-catalog";
import { defineCommand, option } from "../lib/command";

export function getOperationCatalogOutput(family?: string): {
	operations: ReturnType<typeof listCliOperationCatalogSummaries>;
} {
	return { operations: listCliOperationCatalogSummaries(family) };
}

export function handleListOperationsCommand(family?: string): void {
	OutputUtils.json(getOperationCatalogOutput(family));
}

export default defineCommand({
	name: "operations",
	description: "List shared operation contracts available through CLI and MCP",
	options: {
		family: option(z.string().trim().min(1).optional(), {
			description: "Filter by operation family",
		}),
	},
	handler: ({ flags }) => handleListOperationsCommand(flags.family),
});
