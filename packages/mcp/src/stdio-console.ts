import { Console as NodeConsole } from "node:console";

/**
 * Console methods that write to stdout under Bun or Node: Bun also prints
 * `trace` there, and Node prints `timeLog` and `timeEnd` output. `countReset`,
 * `groupEnd`, and `time` print nothing but move with their counterparts so
 * counters, indentation, and timers stay on one console. `assert` writes to
 * stderr in both runtimes, and `clear` writes only to a TTY. The CLI capture
 * in apps/cli/src/lib/output.ts is narrower because the CLI runs only on Bun.
 */
export const STDOUT_CONSOLE_METHODS = [
	"log",
	"info",
	"debug",
	"trace",
	"dir",
	"dirxml",
	"table",
	"count",
	"countReset",
	"group",
	"groupCollapsed",
	"groupEnd",
	"time",
	"timeLog",
	"timeEnd",
] as const;

/**
 * Route every stdout-bound console method to stderr. The stdio transport owns
 * stdout for newline-delimited JSON-RPC, so stray domain or library logging
 * must never reach it. A method the runtime's console lacks is skipped rather
 * than aborting startup with a partially patched console. Returns a function
 * that restores the original methods.
 */
export function routeConsoleStdoutToStderr(
	target: Console = console,
	stderr: NodeJS.WritableStream = process.stderr,
): () => void {
	const stderrConsole = new NodeConsole({ stdout: stderr, stderr });
	const replacements = stderrConsole as unknown as Record<string, unknown>;
	const methods = target as unknown as Record<string, unknown>;
	const originals: (readonly [string, unknown])[] = [];
	for (const method of STDOUT_CONSOLE_METHODS) {
		const implementation = replacements[method];
		if (typeof implementation !== "function") continue;
		originals.push([method, methods[method]]);
		methods[method] = implementation.bind(stderrConsole);
	}
	return () => {
		for (const [method, original] of originals) {
			methods[method] = original;
		}
	};
}
