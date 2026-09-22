import { createListmonkClient } from "@listmonk-ops/openapi";
import { invokeControlStatusOperation } from "@listmonk-ops/operations";
import { z } from "zod";
import packageJson from "../../package.json" with { type: "json" };
import { cliOperationCatalog } from "../operation-catalog";
import { getOutput } from "../lib/output";
import { defineCommand, option } from "../lib/command";
import { resolveListmonkSession } from "../lib/listmonk";

export default defineCommand({
	name: "status",
	description: "Check connectivity, authentication, and selected read access",
	operationId: "control.status",
	options: {
		check: option(z.boolean().default(false), { description: "Exit nonzero unless all requested readiness checks pass" }),
		permissions: option(z.string().optional(), { description: "Comma-separated collection reads to check: lists,subscribers,campaigns" }),
	},
	handler: async (args) => {
		const session = await resolveListmonkSession(args, { requireAuth: false });
		const client = session.client ?? createListmonkClient({ baseUrl: session.baseUrl });
		const status = await invokeControlStatusOperation(
			{
				catalog: cliOperationCatalog,
				surface: "cli",
				version: packageJson.version,
				runtime: {
					platform: process.platform,
					arch: process.arch,
					bun: Bun.version,
					node: process.version,
				},
				target: { url: session.baseUrl, auth: session.apiToken ? "token" : "none" },
				probeReadiness: (resources) => client.getReadiness(resources),
			},
			args.flags.permissions === undefined ? {} : { permissions: args.flags.permissions.split(",").map((value) => value.trim()) },
		);
		getOutput().json(status);
		if (args.flags.check && !Object.values(status.readiness).every(Boolean)) process.exitCode = 1;
	},
});
