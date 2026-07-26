/**
 * Output mode strategies for the CLI.
 *
 * Provides stream-aware output so that:
 * - stdout carries only machine-readable data (JSON, ndjson)
 * - stderr carries human-readable messages (success, info, warnings)
 * - --quiet suppresses human messages entirely
 * - --format json|ndjson|human controls the data format on stdout
 *
 * Each strategy implements the same interface as OutputUtils, so
 * command handlers don't need to change — the output context is
 * swapped at the CLI boundary.
 */

export type OutputFormat = "human" | "json" | "ndjson" | "quiet";

export interface OutputStrategy {
	success(message: string): void;
	error(message: string): void;
	info(message: string): void;
	warning(message: string): void;
	table(data: unknown): void;
	json(data: unknown): void;
}

/**
 * Default human-readable strategy (current behavior):
 * success/info/warning/table/json → stdout, error → stderr.
 */
export const humanOutput: OutputStrategy = {
	success(message) {
		console.log(`✅ ${message}`);
	},
	error(message) {
		console.error(`❌ ${message}`);
	},
	info(message) {
		console.log(`ℹ️  ${message}`);
	},
	warning(message) {
		console.log(`⚠️  ${message}`);
	},
	table(data) {
		console.table(data);
	},
	json(data) {
		console.log(JSON.stringify(data, null, 2));
	},
};

/**
 * JSON-only strategy:
 * json → stdout (pretty-printed), success/info/warning → stderr, table → stderr.
 */
export const jsonOutput: OutputStrategy = {
	success(message) {
		console.error(`✅ ${message}`);
	},
	error(message) {
		console.error(`❌ ${message}`);
	},
	info(message) {
		console.error(`ℹ️  ${message}`);
	},
	warning(message) {
		console.error(`⚠️  ${message}`);
	},
	table(data) {
		console.log(JSON.stringify(data, null, 2));
	},
	json(data) {
		console.log(JSON.stringify(data, null, 2));
	},
};

/**
 * NDJSON strategy:
 * json → stdout (single line, no indentation), everything else → stderr.
 */
export const ndjsonOutput: OutputStrategy = {
	success(message) {
		console.error(`✅ ${message}`);
	},
	error(message) {
		console.error(`❌ ${message}`);
	},
	info(message) {
		console.error(`ℹ️  ${message}`);
	},
	warning(message) {
		console.error(`⚠️  ${message}`);
	},
	table(data) {
		console.error(JSON.stringify(data));
	},
	json(data) {
		console.log(JSON.stringify(data));
	},
};

/**
 * Quiet strategy:
 * json → stdout, everything else suppressed.
 */
export const quietOutput: OutputStrategy = {
	success(_message) {},
	error(message) {
		console.error(`❌ ${message}`);
	},
	info(_message) {},
	warning(_message) {},
	table(_data) {},
	json(data) {
		console.log(JSON.stringify(data));
	},
};

/**
 * Select an output strategy based on the format string.
 */
export function createOutputStrategy(format: OutputFormat): OutputStrategy {
	switch (format) {
		case "json":
			return jsonOutput;
		case "ndjson":
			return ndjsonOutput;
		case "quiet":
			return quietOutput;
		case "human":
		default:
			return humanOutput;
	}
}
