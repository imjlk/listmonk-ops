import { OutputUtils } from "@listmonk-ops/common";
import { createListmonkClientFromEnv } from "@listmonk-ops/openapi";
import { mockListmonkClient } from "./mockClient";

export function initializeListmonkClient() {
	const config = {
		listmonkUrl: Bun.env.LISTMONK_API_URL || "http://localhost:9000/api",
		username: Bun.env.LISTMONK_USERNAME,
		password: Bun.env.LISTMONK_PASSWORD,
		apiToken: Bun.env.LISTMONK_API_TOKEN,
	};

	try {
		if (config.apiToken || (config.username && config.password)) {
			const client = createListmonkClientFromEnv();
			OutputUtils.info(`🚀 Connected to Listmonk at ${config.listmonkUrl}`);
			return client;
		}
		throw new Error("No authentication credentials provided");
	} catch (error) {
		OutputUtils.error(
			`Failed to connect to Listmonk: ${
				error instanceof Error ? error.message : "Unknown error"
			}`,
		);
		OutputUtils.warning("Using mock data for development");
		return mockListmonkClient;
	}
}
