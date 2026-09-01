#!/usr/bin/env bun

import completion from "@gunshi/plugin-completion";
import { cli, define } from "gunshi";
import {
	closeOutboundWebhookRuntimeRepositories,
	closeSequenceRuntimeRepositories,
} from "@listmonk-ops/automation";
import packageJson from "../package.json" with { type: "json" };

import abtestCommand from "./commands/abtest";
import bouncesCommand from "./commands/bounces";
import campaignsCommand from "./commands/campaigns";
import capabilitiesCommand from "./commands/capabilities";
import deliverabilityCommand from "./commands/deliverability";
import examplesCommand from "./commands/examples";
import listsCommand from "./commands/lists";
import mediaCommand from "./commands/media";
import opsCommand from "./commands/ops";
import operationsCommand from "./commands/operations";
import playbooksCommand from "./commands/playbooks";
import primeCommand from "./commands/prime";
import providersCommand from "./commands/providers";
import specsCommand from "./commands/specs";
import statusCommand from "./commands/status";
import sequencesCommand from "./commands/sequences";
import subscribersCommand from "./commands/subscribers";
import templatesCommand from "./commands/templates";
import txCommand from "./commands/tx";
import userRolesCommand from "./commands/user-roles";
import webhooksCommand from "./commands/webhooks";
import { prepareCliArgv } from "./lib/command";

const entry = define({
	name: "listmonk-cli",
	description: "CLI for Listmonk operations",
	run: () => undefined,
});

const subCommands = {
	status: statusCommand,
	providers: providersCommand,
	deliverability: deliverabilityCommand,
	sequences: sequencesCommand,
	capabilities: capabilitiesCommand,
	prime: primeCommand,
	examples: examplesCommand,
	bounces: bouncesCommand,
	campaigns: campaignsCommand,
	lists: listsCommand,
	media: mediaCommand,
	subscribers: subscribersCommand,
	templates: templatesCommand,
	tx: txCommand,
	"user-roles": userRolesCommand,
	abtest: abtestCommand,
	ops: opsCommand,
	operations: operationsCommand,
	specs: specsCommand,
	playbooks: playbooksCommand,
	webhooks: webhooksCommand,
};

import { getRuntimeFlags } from "./lib/command";

const argv = prepareCliArgv(process.argv.slice(2));
const flags = getRuntimeFlags();
// In machine-readable output modes, suppress service-level console
// output (warnings, info, statistical summaries) that would corrupt
// stdout JSON.
if (flags.format && flags.format !== "human") {
	process.env.LISTMONK_OPS_ABTEST_SILENT = "1";
}

let commandError: unknown;
try {
	await cli(argv, entry, {
		name: "listmonk-cli",
		version: packageJson.version,
		description: "CLI for Listmonk operations",
		strict: true,
		subCommands,
		plugins: [completion()],
	});
} catch (error) {
	commandError = error;
	throw error;
} finally {
	const closeResults = await Promise.allSettled([
		closeOutboundWebhookRuntimeRepositories(),
		closeSequenceRuntimeRepositories(),
	]);
	const closeFailures = closeResults
		.filter(
			(result): result is PromiseRejectedResult =>
				result.status === "rejected",
		)
		.map((result) => result.reason);
	if (closeFailures.length > 0) {
		const error = new AggregateError(
			closeFailures,
			"Failed to close one or more runtime repositories",
		);
		if (commandError === undefined) {
			throw error;
		}
		console.error("⚠️ Failed to close runtime repositories:", error);
	}
}
