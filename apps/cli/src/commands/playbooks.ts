import {
	invokePlaybookGetOperation,
	invokePlaybookListOperation,
} from "@listmonk-ops/operations";
import { z } from "zod";
import { cliOperationCatalog } from "../operation-catalog";
import { defineCommand, defineGroup, option } from "../lib/command";
import { getOutput } from "../lib/output";

const listCommand = defineCommand({
	name: "list",
	description: "List typed safe-operation playbooks",
	operationId: "playbooks.list",
	handler: async () => {
		getOutput().json(
			await invokePlaybookListOperation(
				{ catalog: cliOperationCatalog },
				{},
			),
		);
	},
});

const getCommand = defineCommand({
	name: "get",
	description: "Get a playbook and its referenced operation contracts",
	operationId: "playbooks.get",
	options: {
		id: option(z.string().trim().min(1), {
			description: "Playbook ID",
		}),
	},
	handler: async ({ flags }) => {
		getOutput().json(
			await invokePlaybookGetOperation(
				{ catalog: cliOperationCatalog },
				flags,
			),
		);
	},
});

export default defineGroup({
	name: "playbooks",
	description: "Discover typed multi-step operation playbooks",
	commands: [listCommand, getCommand],
});
