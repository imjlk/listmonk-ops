import "dotenv/config";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ListmonkMCPServer } from "./server.js";

interface RuntimeArgs {
	baseUrl?: string;
	username?: string;
	password?: string;
	apiToken?: string;
	host?: string;
	port?: number;
	help?: boolean;
}

function printHelp(): void {
	console.log(`listmonk-mcp

Usage:
  listmonk-mcp [options]

Options:
  --listmonk-url <url>         Listmonk API URL (e.g. http://localhost:9000/api)
  --listmonk-username <name>   Listmonk username
  --listmonk-password <pass>   Listmonk password
  --listmonk-api-token <token> Listmonk API token
  --host <host>                MCP server host (default: localhost)
  --port <port>                MCP server port (default: 3000)
  --help                       Show this help

Environment fallback:
  LISTMONK_API_URL
  LISTMONK_USERNAME
  LISTMONK_PASSWORD
  LISTMONK_API_TOKEN
  MCP_SERVER_HOST
  MCP_SERVER_PORT
`);
}

function parseArgs(argv: string[]): RuntimeArgs {
	const args: RuntimeArgs = {};
	const takeValue = (arg: string, next: string | undefined): string | undefined => {
		if (arg.includes("=")) {
			const [, value] = arg.split("=", 2);
			return value;
		}
		return next;
	};

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (!arg) {
			continue;
		}

		const next = argv[index + 1];

		switch (true) {
			case arg === "--help":
			case arg === "-h":
				args.help = true;
				break;
			case arg.startsWith("--listmonk-url"):
			case arg.startsWith("--listmonk-api-url"): {
				const value = takeValue(arg, next);
				if (value !== undefined && !arg.includes("=")) {
					index += 1;
				}
				args.baseUrl = value;
				break;
			}
			case arg.startsWith("--listmonk-username"): {
				const value = takeValue(arg, next);
				if (value !== undefined && !arg.includes("=")) {
					index += 1;
				}
				args.username = value;
				break;
			}
			case arg.startsWith("--listmonk-password"): {
				const value = takeValue(arg, next);
				if (value !== undefined && !arg.includes("=")) {
					index += 1;
				}
				args.password = value;
				break;
			}
			case arg.startsWith("--listmonk-api-token"): {
				const value = takeValue(arg, next);
				if (value !== undefined && !arg.includes("=")) {
					index += 1;
				}
				args.apiToken = value;
				break;
			}
			case arg.startsWith("--host"): {
				const value = takeValue(arg, next);
				if (value !== undefined && !arg.includes("=")) {
					index += 1;
				}
				args.host = value;
				break;
			}
			case arg.startsWith("--port"): {
				const value = takeValue(arg, next);
				if (value !== undefined && !arg.includes("=")) {
					index += 1;
				}
				const parsed = Number(value);
				if (Number.isFinite(parsed) && parsed > 0) {
					args.port = parsed;
				}
				break;
			}
			default:
				break;
		}
	}

	return args;
}

export async function main() {
	const runtimeArgs = parseArgs(process.argv.slice(2));
	if (runtimeArgs.help) {
		printHelp();
		return;
	}

	const config = {
		baseUrl:
			runtimeArgs.baseUrl ||
			process.env.LISTMONK_API_URL ||
			"http://localhost:9000/api",
		username:
			runtimeArgs.username || process.env.LISTMONK_USERNAME || "api-admin",
		password: runtimeArgs.password || process.env.LISTMONK_PASSWORD || "",
		apiToken: runtimeArgs.apiToken || process.env.LISTMONK_API_TOKEN || "",
	};

	const port = runtimeArgs.port || Number(process.env.MCP_SERVER_PORT) || 3000;
	const host = runtimeArgs.host || process.env.MCP_SERVER_HOST || "localhost";

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

const isMainModule = (() => {
	// Bun runtime
	if (
		typeof Bun !== "undefined" &&
		typeof (import.meta as { main?: boolean }).main === "boolean"
	) {
		return (import.meta as { main: boolean }).main;
	}

	// Node ESM runtime
	if (!process.argv[1]) {
		return false;
	}

	try {
		return (
			realpathSync(fileURLToPath(import.meta.url)) ===
			realpathSync(resolve(process.argv[1]))
		);
	} catch {
		return fileURLToPath(import.meta.url) === resolve(process.argv[1]);
	}
})();

if (isMainModule) {
	main().catch((error) => {
		console.error("❌ Unhandled error:", error);
		process.exit(1);
	});
}
