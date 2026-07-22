#!/usr/bin/env bun

import completion from "@gunshi/plugin-completion";
import { cli, define } from "gunshi";
import packageJson from "../package.json" with { type: "json" };

import abtestCommand from "./commands/abtest";
import campaignsCommand from "./commands/campaigns";
import examplesCommand from "./commands/examples";
import listsCommand from "./commands/lists";
import opsCommand from "./commands/ops";
import operationsCommand from "./commands/operations";
import statusCommand from "./commands/status";
import subscribersCommand from "./commands/subscribers";
import templatesCommand from "./commands/templates";
import txCommand from "./commands/tx";
import { prepareCliArgv } from "./lib/command";

const entry = define({
	name: "listmonk-cli",
	description: "CLI for Listmonk operations",
	run: () => undefined,
});

const subCommands = {
	status: statusCommand,
	examples: examplesCommand,
	campaigns: campaignsCommand,
	lists: listsCommand,
	subscribers: subscribersCommand,
	templates: templatesCommand,
	tx: txCommand,
	abtest: abtestCommand,
	ops: opsCommand,
	operations: operationsCommand,
};

await cli(prepareCliArgv(process.argv.slice(2)), entry, {
	name: "listmonk-cli",
	version: packageJson.version,
	description: "CLI for Listmonk operations",
	strict: true,
	subCommands,
	plugins: [completion()],
});
