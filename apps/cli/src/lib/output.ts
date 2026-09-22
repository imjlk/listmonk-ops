import { createOutputStrategy, type OutputFormat } from "@listmonk-ops/common";
import { getRuntimeFlags } from "./command";

export function getOutput() {
	const flags = getRuntimeFlags();
	const format = (flags.format ?? "human") as OutputFormat;
	return createOutputStrategy(format);
}

export interface CliDiagnostic {
	level: "info" | "warning" | "error";
	message: string;
}

/** Capture process-local diagnostics until the one-shot CLI result is known. */
export function captureCliDiagnostics() {
	const diagnostics: CliDiagnostic[] = [];
	const original = {
		info: console.info,
		warn: console.warn,
		error: console.error,
	};
	let truncated = false;
	const capture = (level: CliDiagnostic["level"], args: unknown[]) => {
		if (diagnostics.length >= 20) {
			truncated = true;
			return;
		}
		const message = args.slice(0, 8).map((value) => {
			if (value instanceof Error) return value.message.slice(0, 1024);
			if (typeof value === "string") return value.slice(0, 1024);
			if (typeof value === "number" || typeof value === "boolean" || value === null) return String(value);
			return "[diagnostic details omitted]";
		}).join(" ").slice(0, 1024);
		diagnostics.push({ level, message });
	};
	console.info = (...args: unknown[]) => capture("info", args);
	console.warn = (...args: unknown[]) => capture("warning", args);
	console.error = (...args: unknown[]) => capture("error", args);
	return {
		diagnostics,
		get truncated() {
			return truncated;
		},
		restore() {
			console.info = original.info;
			console.warn = original.warn;
			console.error = original.error;
		},
	};
}

type CapturedDiagnostics = ReturnType<typeof captureCliDiagnostics>;

function diagnosticFields(captured?: CapturedDiagnostics) {
	if (!captured?.diagnostics.length || getRuntimeFlags().format === "quiet") return {};
	return {
		diagnostics: captured.diagnostics,
		...(captured.truncated ? { diagnostics_truncated: true } : {}),
	};
}

/** Flush nonfatal messages as one JSON document after restoring console methods. */
export function renderCliDiagnostics(captured?: CapturedDiagnostics): void {
	const fields = diagnosticFields(captured);
	if ("diagnostics" in fields) console.error(JSON.stringify(fields));
}

/** Render a bounded diagnostic without runtime stack frames or source snippets. */
export function renderCliError(error: unknown, captured?: CapturedDiagnostics): void {
	const errors = error instanceof AggregateError && error.errors.length > 0
		? error.errors.slice(0, 10)
		: [error];
	const message = errors.map((entry: unknown) => (entry instanceof Error ? entry.message : String(entry)).slice(0, 4096)).join("; ").slice(
		0,
		4096,
	);
	const format = getRuntimeFlags().format;
	if (format === "json" || format === "ndjson" || format === "quiet") {
		console.error(
			JSON.stringify({
				error: { code: "cli_error", message },
				...diagnosticFields(captured),
			}),
		);
	} else {
		console.error(`Error: ${message}`);
	}
}
