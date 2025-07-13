import "dotenv/config";
import { ListmonkMCPServer } from "./server.js";

async function main() {
	const config = {
		baseUrl: process.env.LISTMONK_API_URL || "http://localhost:9000/api",
		username: process.env.LISTMONK_USERNAME || "api-admin",
		password: process.env.LISTMONK_PASSWORD || "",
		apiToken: process.env.LISTMONK_API_TOKEN || "",
	};

	const port = Number(process.env.MCP_SERVER_PORT) || 3000;
	const host = process.env.MCP_SERVER_HOST || "localhost";

	// Validate required config
	if (
		!config.baseUrl ||
		!config.username ||
		(!config.password && !config.apiToken)
	) {
		console.error("❌ Missing required configuration:");
		console.error(
			"   LISTMONK_API_URL, LISTMONK_USERNAME, and either LISTMONK_PASSWORD or LISTMONK_API_TOKEN",
		);
		console.error("   Please check your .env file or environment variables");
		process.exit(1);
	}

	try {
		const server = new ListmonkMCPServer(config);
		await server.listen(port, host);
	} catch (error) {
		console.error("❌ Failed to start server:", error);
		process.exit(1);
	}
}

// Handle graceful shutdown
process.on("SIGINT", () => {
	console.log("\n🛑 Shutting down server...");
	process.exit(0);
});

process.on("SIGTERM", () => {
	console.log("\n🛑 Shutting down server...");
	process.exit(0);
});

if (import.meta.main) {
	main().catch((error) => {
		console.error("❌ Unhandled error:", error);
		process.exit(1);
	});
}
