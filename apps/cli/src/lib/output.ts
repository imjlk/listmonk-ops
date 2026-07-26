import { createOutputStrategy, type OutputFormat } from "@listmonk-ops/common";
import { getRuntimeFlags } from "./command";

export function getOutput() {
	const flags = getRuntimeFlags();
	const format = (flags.format ?? "human") as OutputFormat;
	return createOutputStrategy(format);
}
