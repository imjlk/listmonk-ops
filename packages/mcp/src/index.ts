import { realpathSync } from "node:fs";
import {
	resolveListmonkConfiguration,
	type ListmonkConfigurationSummary,
} from "@listmonk-ops/common";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	closeOutboundWebhookRuntimeRepositories,
	closeSequenceRuntimeRepositories,
} from "@listmonk-ops/automation";
import type { ListmonkMCPServer } from "./server.js";

interface RuntimeArgs {
	profile?: string;
	configFile?: string;
	tokenFile?: string;
	baseUrl?: string;
	username?: string;
	password?: string;
	apiToken?: string;
	host?: string;
	port?: number;
	help?: boolean;
	transport?: "http" | "stdio";
}

type MCPServerConfig = {
	baseUrl: string;
	username: string;
	password: string;
	apiToken: string;
	credentialProvider?: () => Promise<string | undefined>;
	configuration?: ListmonkConfigurationSummary;
	httpAuthToken?: string;
	allowedHttpHosts?: string[];
	allowedHttpOrigins?: string[];
};

type BunHttpServer = {
	stop(closeActiveConnections?: boolean): void;
};

let activeHttpServer: BunHttpServer | undefined;
let shutdownPromise: Promise<void> | undefined;

async function shutdownRuntime(): Promise<void> {
	shutdownPromise ??= (async () => {
		const failures: unknown[] = [];
		try {
			activeHttpServer?.stop(true);
		} catch (error) {
			failures.push(error);
		} finally {
			activeHttpServer = undefined;
		}
		const closeResults = await Promise.allSettled([
			closeOutboundWebhookRuntimeRepositories(),
			closeSequenceRuntimeRepositories(),
		]);
		for (const result of closeResults) {
			if (result.status === "rejected") {
				failures.push(result.reason);
			}
		}
		if (failures.length > 0) {
			throw new AggregateError(
				failures,
				"Failed to stop the MCP runtime cleanly",
			);
		}
	})();
	await shutdownPromise;
}

function reportShutdownError(error: unknown): void {
	console.error("⚠️ Failed to close the MCP runtime cleanly:", error);
}

function handleShutdownSignal(): void {
	console.error("\n🛑 Shutting down server...");
	void shutdownRuntime().then(
		() => process.exit(0),
		(error) => {
			reportShutdownError(error);
			process.exit(1);
		},
	);
}

async function createMCPServer(
	config: MCPServerConfig,
): Promise<InstanceType<typeof ListmonkMCPServer>> {
	const { ListmonkMCPServer } = await import("./server.js");
	return new ListmonkMCPServer(config);
}

const DEFAULT_HTTP_PORT = 3000;

/** Invalid options or environment; reported without a stack trace. */
class McpUsageError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = "McpUsageError";
	}
}

function parsePort(value: string, source: string): number {
	const port = /^\d+$/.test(value) ? Number(value) : Number.NaN;
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new McpUsageError(
			`Invalid ${source}: ${value}. Use an integer from 1 to 65535.`,
		);
	}
	return port;
}

function resolveHttpPort(flagPort: number | undefined): number {
	if (flagPort !== undefined) {
		return flagPort;
	}
	const environmentPort = process.env.MCP_SERVER_PORT?.trim();
	return environmentPort
		? parsePort(environmentPort, "MCP_SERVER_PORT")
		: DEFAULT_HTTP_PORT;
}

function parseCommaSeparatedEnv(value: string | undefined): string[] {
	return value
		? value
				.split(",")
				.map((entry) => entry.trim())
				.filter(Boolean)
		: [];
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
  --profile <name>            Select a shared connection profile
  --config <path>             Shared profile configuration file
  --token-file <path>         Read the API token from a file on each operation
  --host <host>                MCP server host (default: localhost)
  --port <port>                MCP server port (default: 3000)
  --transport <http|stdio>     MCP transport (default: http)
  --stdio                      Alias for --transport stdio
  --help                       Show this help

Environment fallback:
  LISTMONK_API_URL
  LISTMONK_USERNAME
  LISTMONK_PASSWORD
  LISTMONK_API_TOKEN
  LISTMONK_API_TOKEN_FILE     Token file (relative paths resolve from home)
  LISTMONK_OPS_CONFIG         Shared profile configuration path
  LISTMONK_OPS_PROFILE        Selected connection profile
  LISTMONK_OPS_DATA_DIR       Default state root when no profile is selected
  MCP_SERVER_HOST
  MCP_SERVER_PORT
  MCP_HTTP_AUTH_TOKEN          Optional Bearer token for all routes except GET/HEAD / and /health
  MCP_HTTP_ALLOWED_HOSTS       Comma-separated hostnames for non-loopback HTTP
  MCP_HTTP_ALLOWED_ORIGINS     Comma-separated browser origins for non-loopback HTTP
  LISTMONK_OPS_WEBHOOK_STORE   File-backed webhook endpoint/outbox path
  LISTMONK_OPS_WEBHOOK_DATABASE_URL
                               Postgres webhook endpoint/outbox URL (exclusive with file store)
  LISTMONK_OPS_SEQUENCE_STORE  File-backed sequence definition/enrollment path
  LISTMONK_OPS_SEQUENCE_DATABASE_URL
                               Postgres sequence runtime URL (exclusive with file store)
  LISTMONK_OPS_PROVIDER_CONFIG Versioned provider profile JSON for read-only diagnostics
`);
}

function parseArgs(argv: string[]): RuntimeArgs {
	const args: RuntimeArgs = {};
	const options = {
		"--listmonk-url": "baseUrl",
		"--listmonk-api-url": "baseUrl",
		"--listmonk-username": "username",
		"--listmonk-password": "password",
		"--listmonk-api-token": "apiToken",
		"--profile": "profile",
		"--config": "configFile",
		"--token-file": "tokenFile",
		"--host": "host",
	} as const;
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index]!;
		if (argument === "--help" || argument === "-h") {
			args.help = true;
			continue;
		}
		if (argument === "--stdio") {
			args.transport = "stdio";
			continue;
		}
		const separator = argument.indexOf("=");
		const flag = separator < 0 ? argument : argument.slice(0, separator);
		if (!Object.hasOwn(options, flag) && flag !== "--port" && flag !== "--transport") throw new McpUsageError(`Unknown MCP option: ${flag}`);
		const value = separator < 0 ? argv[++index] : argument.slice(separator + 1);
		if (!value || value.startsWith("--")) throw new McpUsageError(`${flag} requires a value`);
		if (flag === "--port") {
			args.port = parsePort(value, "--port");
		} else if (flag === "--transport") {
			if (value !== "http" && value !== "stdio") throw new McpUsageError(`Invalid --transport: ${value}. Use http or stdio.`);
			args.transport = value;
		} else args[options[flag as keyof typeof options]] = value;
	}
	return args;
}

async function startRuntime(argv: string[]): Promise<void> {
	const runtimeArgs = parseArgs(argv);
	if (runtimeArgs.help) {
		printHelp();
		return;
	}

	const transport = runtimeArgs.transport || "http";
	// Like the MCP_HTTP_* variables, MCP_SERVER_PORT only applies to HTTP.
	const port =
		transport === "http"
			? resolveHttpPort(runtimeArgs.port)
			: DEFAULT_HTTP_PORT;
	const host = runtimeArgs.host || process.env.MCP_SERVER_HOST || "localhost";
	const resolved = await resolveListmonkConfiguration({
		profile: runtimeArgs.profile,
		configFile: runtimeArgs.configFile,
		tokenFile: runtimeArgs.tokenFile,
		baseUrl: runtimeArgs.baseUrl,
		username: runtimeArgs.username,
		apiToken: runtimeArgs.apiToken,
		password: runtimeArgs.password,
		allowLegacyPassword: true,
	});
	process.env.LISTMONK_OPS_DATA_DIR = resolved.summary.dataDirectory;
	const initialCredential = await resolved.readCredential();
	const config = {
		baseUrl: resolved.summary.baseUrl,
		username: resolved.summary.username,
		password: "",
		apiToken: initialCredential ?? "",
		credentialProvider: resolved.readCredential,
		configuration: resolved.summary,
		httpAuthToken:
			transport === "http" ? process.env.MCP_HTTP_AUTH_TOKEN : undefined,
		allowedHttpHosts:
			transport === "http"
				? parseCommaSeparatedEnv(process.env.MCP_HTTP_ALLOWED_HOSTS)
				: [],
		allowedHttpOrigins:
			transport === "http"
				? parseCommaSeparatedEnv(process.env.MCP_HTTP_ALLOWED_ORIGINS)
				: [],
	};

	// Validate required config
	if (
		!config.baseUrl ||
		!config.username ||
		(!config.password && !config.apiToken)
	) {
		console.error("❌ Missing required configuration:");
		console.error(
			"   Check the selected profile tokenEnv/tokenFile, --token-file, or legacy token/password environment configuration.",
		);

		process.exit(1);
	}

	try {
		const server = await createMCPServer(config);
		if (transport === "stdio") {
			const [
				{ StdioServerTransport },
				{ connectMCPTransportUntilClosed },
			] =
				await Promise.all([
					import("@modelcontextprotocol/sdk/server/stdio.js"),
					import("./protocol.js"),
				]);
			let transportError: unknown;
			try {
				await connectMCPTransportUntilClosed(
					server,
					new StdioServerTransport(),
				);
			} catch (error) {
				transportError = error;
				throw error;
			} finally {
				try {
					await shutdownRuntime();
				} catch (shutdownError) {
					if (transportError === undefined) {
						throw shutdownError;
					}
					reportShutdownError(shutdownError);
				}
			}
			return;
		}

		activeHttpServer = await server.listen(port, host);
	} catch (error) {
		try {
			await shutdownRuntime();
		} catch (shutdownError) {
			reportShutdownError(shutdownError);
		}
		console.error("❌ Failed to start server:", error);
		process.exit(1);
	}
}

export async function main() {
	try {
		await startRuntime(process.argv.slice(2));
	} catch (error) {
		if (!(error instanceof McpUsageError)) {
			throw error;
		}
		console.error(`❌ ${error.message}`);
		console.error("   Run `listmonk-mcp --help` for usage.");
		process.exit(1);
	}
}

// Handle graceful shutdown
process.on("SIGINT", handleShutdownSignal);
process.on("SIGTERM", handleShutdownSignal);

const isMainModule = (() => {
	// Bun runtime
	if (
		typeof Bun !== "undefined" &&
		typeof (import.meta as { main?: boolean | undefined }).main === "boolean"
	) {
		return (import.meta as { main?: boolean }).main === true;
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
