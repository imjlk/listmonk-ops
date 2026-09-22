import { createOutputStrategy, type OutputFormat } from "@listmonk-ops/common";
import { getRuntimeFlags } from "./command";

export function getOutput() {
	const flags = getRuntimeFlags();
	const format = (flags.format ?? "human") as OutputFormat;
	return createOutputStrategy(format);
}

/** Render a bounded diagnostic without runtime stack frames or source snippets. */
export function renderCliError(error: unknown): void {
	const errors = error instanceof AggregateError
		? error.errors.slice(0, 10)
		: [error];
	const message = errors.map((entry: unknown) => entry instanceof Error ? entry.message : String(entry)).join("; ").slice(
		0,
		4096,
	);
	const format = getRuntimeFlags().format;
	if (format === "json" || format === "ndjson" || format === "quiet") {
		console.error(JSON.stringify({ error: { code: "cli_error", message } }));
	} else {
		console.error(`Error: ${message}`);
	}
}
