import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveListmonkConfiguration } from "@listmonk-ops/common";

// WHATWG URL keeps the brackets of an IPv6 literal in `hostname`, so
// `http://[::1]:9000/api` reports `[::1]`, never `::1`.
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set([
	"localhost",
	"127.0.0.1",
	"[::1]",
]);

export function isLoopbackListmonkUrl(value: string): boolean {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	return (
		(url.protocol === "http:" || url.protocol === "https:") &&
		LOOPBACK_HOSTNAMES.has(url.hostname)
	);
}

/**
 * Pin CLI and MCP subprocesses to the harness's environment-based target.
 *
 * Subprocesses spread `process.env`, and a shared connection profile selected
 * by `~/.listmonk-ops/config.json` (`defaultProfile`), `LISTMONK_OPS_CONFIG`,
 * or `LISTMONK_OPS_PROFILE` replaces LISTMONK_API_URL and the token, while
 * `LISTMONK_API_TOKEN_FILE` replaces the token. This writes an empty profile
 * document into `directory` and returns variables that select it. Selectors
 * are blank rather than deleted so Bun's `.env` autoload in a child process
 * cannot restore them, and state defaults to `directory/data` instead of the
 * operator's `~/.listmonk-ops`.
 */
export function createIsolatedListmonkEnvironment(
	directory: string,
): Record<string, string> {
	const configFile = join(directory, "config.json");
	writeFileSync(
		configFile,
		`${JSON.stringify({ schemaVersion: 1, profiles: {} })}\n`,
		{ mode: 0o600 },
	);
	return {
		LISTMONK_OPS_CONFIG: configFile,
		LISTMONK_OPS_PROFILE: "",
		LISTMONK_API_TOKEN_FILE: "",
		LISTMONK_OPS_DATA_DIR: join(directory, "data"),
	};
}

/**
 * Resolve the target exactly as a CLI or MCP subprocess would from `env` and
 * fail closed unless it is the harness target and loopback, or the operator
 * explicitly allowed a remote target.
 */
export async function assertLocalListmonkTarget(options: {
	env: Readonly<Record<string, string | undefined>>;
	expectedBaseUrl: string;
	allowRemote: boolean;
	homeDirectory?: string;
}): Promise<string> {
	const { summary } = await resolveListmonkConfiguration({
		env: options.env,
		...(options.homeDirectory === undefined
			? {}
			: { homeDirectory: options.homeDirectory }),
	});
	if (summary.baseUrl !== options.expectedBaseUrl) {
		throw new Error(
			`CLI subprocesses would target ${summary.baseUrl} instead of the E2E target ${options.expectedBaseUrl}`,
		);
	}
	if (!options.allowRemote && !isLoopbackListmonkUrl(summary.baseUrl)) {
		throw new Error(
			`Refusing to run MCP E2E against non-local target ${summary.baseUrl}. Set LISTMONK_E2E_ALLOW_REMOTE=1 to override.`,
		);
	}
	return summary.baseUrl;
}
