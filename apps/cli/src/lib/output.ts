import { createOutputStrategy, type OutputFormat } from "@listmonk-ops/common";
import { getRuntimeFlags } from "./command";

type DiagnosticSink = (level: CliDiagnostic["level"], args: unknown[]) => void;
let activeDiagnosticSink: DiagnosticSink | undefined;

export function getOutput() {
	const format = (getRuntimeFlags().format ?? "human") as OutputFormat;
	const output = createOutputStrategy(format);
	const sink = activeDiagnosticSink;
	if ((format !== "json" && format !== "ndjson") || sink === undefined) return output;
	return {
		...output,
		success: (message: string) => sink("success", [message]),
		info: (message: string) => sink("info", [message]),
		warning: (message: string) => sink("warning", [message]),
		error: (message: string) => sink("error", [message]),
	};
}

export interface CliDiagnostic {
	level: "success" | "info" | "warning" | "error";
	message: string;
}

/** Buffer JSON diagnostics or stream bounded NDJSON records at the CLI boundary. */
export function captureCliDiagnostics(options: { stream?: boolean } = {}) {
	const diagnostics: CliDiagnostic[] = [];
	const original = {
		info: console.info,
		warn: console.warn,
		error: console.error,
	};
	const previousSink = activeDiagnosticSink;
	let truncated = false;
	const capture = (level: CliDiagnostic["level"], args: unknown[]) => {
		if (!options.stream && diagnostics.length >= 20) {
			truncated = true;
			return;
		}
		const message = args.slice(0, 8).map((value) => {
			if (value instanceof Error) return value.message.slice(0, 1024);
			if (typeof value === "string") return value.slice(0, 1024);
			if (typeof value === "number" || typeof value === "boolean" || value === null) return String(value);
			return "[diagnostic details omitted]";
		}).join(" ").slice(0, 1024);
		if (options.stream) {
			original.error.call(
				console,
				JSON.stringify({ diagnostic: { level, message } }),
			);
		} else {
			diagnostics.push({ level, message });
		}
	};
	activeDiagnosticSink = capture;
	console.info = (...args: unknown[]) => capture("info", args);
	console.warn = (...args: unknown[]) => capture("warning", args);
	console.error = (...args: unknown[]) => capture("error", args);
	return {
		diagnostics,
		get truncated() {
			return truncated;
		},
		restore() {
			activeDiagnosticSink = previousSink;
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
