import { defineCommand } from "@bunli/core";
import { OutputUtils } from "@listmonk-ops/common";

import { toErrorMessage } from "../lib/command-utils";
import { resolveListmonkSession } from "../lib/listmonk";

export default defineCommand({
	name: "status",
	description: "Check runtime and Listmonk connectivity",
	handler: async (args) => {
		const session = await resolveListmonkSession(args, { requireAuth: false });

		let reachable = false;
		let auth = session.apiToken ? "token" : "none";
		let healthError: string | undefined;

		if (session.client) {
			auth = "token";
			try {
				const health = await session.client.getHealthCheck();
				reachable = Boolean(health.data);
			} catch (error) {
				healthError = toErrorMessage(error);
			}
		}

		OutputUtils.json({
			runtime: {
				platform: process.platform,
				arch: process.arch,
				bun: Bun.version,
				node: process.version,
			},
			listmonk: {
				url: session.baseUrl,
				auth,
				reachable,
				healthError,
			},
		});
	},
});
