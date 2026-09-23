import {
	resolveListmonkConfiguration,
	type ResolvedListmonkConfiguration,
} from "@listmonk-ops/common";
import { getRuntimeFlags } from "./command";

let activeConfiguration: ResolvedListmonkConfiguration | undefined;

export async function resolveCliConfiguration(): Promise<ResolvedListmonkConfiguration> {
	if (activeConfiguration) return activeConfiguration;
	const flags = getRuntimeFlags();
	return resolveListmonkConfiguration({
		profile: flags.profile,
		configFile: flags.configFile,
		baseUrl: flags.listmonkUrl,
		username: flags.listmonkUsername,
		tokenFile: flags.tokenFile,
	});
}

/** Apply the profile namespace before operation audit or any file repository is opened. */
export async function initializeCliConfiguration(): Promise<void> {
	activeConfiguration = await resolveCliConfiguration();
	process.env.LISTMONK_OPS_DATA_DIR = activeConfiguration.summary.dataDirectory;
}
