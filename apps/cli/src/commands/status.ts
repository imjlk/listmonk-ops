import { invokeControlStatusOperation } from "@listmonk-ops/operations";
import packageJson from "../../package.json" with { type: "json" };
import { cliOperationCatalog } from "../operation-catalog";
import { getOutput } from "../lib/output";
import { defineCommand } from "../lib/command";
import { resolveListmonkSession } from "../lib/listmonk";

export default defineCommand({
	name: "status",
	description: "Check runtime and Listmonk connectivity",
	operationId: "control.status",
	handler: async (args) => {
		const session = await resolveListmonkSession(args, { requireAuth: false });
		getOutput().json(
			await invokeControlStatusOperation(
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
					target: {
						url: session.baseUrl,
						auth: session.apiToken ? "token" : "none",
					},
					...(session.client === null
						? {}
						: {
								probeListmonk: async () => {
									const health = await session.client?.getHealthCheck();
									return Boolean(health?.data);
								},
							}),
				},
				{},
			),
		);
	},
});
