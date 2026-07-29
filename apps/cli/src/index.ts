#!/usr/bin/env bun

import completion from "@gunshi/plugin-completion";
import { cli, define } from "gunshi";
import packageJson from "../package.json" with { type: "json" };

import abtestCommand from "./commands/abtest";
import campaignsCommand from "./commands/campaigns";
import capabilitiesCommand from "./commands/capabilities";
import examplesCommand from "./commands/examples";
import listsCommand from "./commands/lists";
import mediaCommand from "./commands/media";
import opsCommand from "./commands/ops";
import operationsCommand from "./commands/operations";
import playbooksCommand from "./commands/playbooks";
import primeCommand from "./commands/prime";
import specsCommand from "./commands/specs";
import statusCommand from "./commands/status";
import subscribersCommand from "./commands/subscribers";
import templatesCommand from "./commands/templates";
import txCommand from "./commands/tx";
import webhooksCommand from "./commands/webhooks";
import { prepareCliArgv } from "./lib/command";

const entry = define({
	name: "listmonk-cli",
	description: "CLI for Listmonk operations",
	run: () => undefined,
});

const subCommands = {
	status: statusCommand,
	capabilities: capabilitiesCommand,
	prime: primeCommand,
	examples: examplesCommand,
	campaigns: campaignsCommand,
	lists: listsCommand,
	media: mediaCommand,
	subscribers: subscribersCommand,
	templates: templatesCommand,
	tx: txCommand,
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

await cli(argv, entry, {
	name: "listmonk-cli",
	version: packageJson.version,
	description: "CLI for Listmonk operations",
	strict: true,
	subCommands,
	plugins: [completion()],
});
