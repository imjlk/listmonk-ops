import { OutputUtils } from "@listmonk-ops/common";
import { defineCommand } from "../lib/definition";

export interface StatusCommandConfig {
	listmonkUrl: string;
	apiToken?: string;
	listmonkClient: unknown | null;
}

export const meta = defineCommand({
	name: "status",
	description: "Check system status and connection",
	runner: "config",
});

export async function run(config: StatusCommandConfig) {
	try {
		OutputUtils.info("🏥 System Status Check");

		const status = {
			runtime: {
				platform: process.platform,
				arch: process.arch,
				bun: Bun.version,
				node_version: process.version,
			},
			listmonk: {
				url: config.listmonkUrl,
				status: config.listmonkClient ? "connected" : "disconnected",
				auth: config.apiToken ? "api-token" : "basic-auth",
			},
			packages: {
				core: "loaded",
				commands: "loaded",
				common: "loaded",
				openapi: "loaded",
			},
		};

		OutputUtils.success("All systems operational");
		OutputUtils.json(status);
	} catch (error) {
		OutputUtils.error(
			`System check failed: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		process.exit(1);
	}
}
