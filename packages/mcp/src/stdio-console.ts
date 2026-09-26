import { Console as NodeConsole } from "node:console";

/**
 * Console methods that write to stdout under Bun or Node: Bun also prints
 * `trace` there, and Node prints `timeLog` and `timeEnd` output. `countReset`,
 * `groupEnd`, and `time` print nothing but move with their counterparts so
 * counters, indentation, and timers stay on one console.
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
 * must never reach it. Returns a function that restores the original methods.
 */
export function routeConsoleStdoutToStderr(
	target: Console = console,
	stderr: NodeJS.WritableStream = process.stderr,
): () => void {
	const stderrConsole = new NodeConsole({ stdout: stderr, stderr });
	const methods = target as unknown as Record<string, unknown>;
	const originals = STDOUT_CONSOLE_METHODS.map(
		(method) => [method, methods[method]] as const,
	);
	for (const method of STDOUT_CONSOLE_METHODS) {
		const implementation: (...args: never[]) => void = stderrConsole[method];
		methods[method] = implementation.bind(stderrConsole);
	}
	return () => {
		for (const [method, original] of originals) {
			methods[method] = original;
		}
	};
}
