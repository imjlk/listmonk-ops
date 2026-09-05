import type { NonEmptyString } from "./primitives";

/** Build and runtime identity of the Listmonk server. */
export interface SystemAboutOutput {
	version?: string | undefined;
	build?: string | undefined;
	go_version?: string | undefined;
	go_arch?: string | undefined;
	/** Preserve fields added by newer Listmonk releases. */
	[key: string]: unknown;
}

/** Recent server log lines, newest entries as observed. */
export interface SystemLogsOutput {
	logs: string[];
}
