#!/usr/bin/env bun

import { createCLI } from "@bunli/core";

import abtestCommand from "./commands/abtest";
import campaignsCommand from "./commands/campaigns";
import examplesCommand from "./commands/examples";
import listsCommand from "./commands/lists";
import statusCommand from "./commands/status";
import subscribersCommand from "./commands/subscribers";
import templatesCommand from "./commands/templates";
import txCommand from "./commands/tx";

const cli = await createCLI({
	name: "listmonk-cli",
	version: "0.2.0",
	description: "CLI for Listmonk operations",
});

cli.command(statusCommand);
cli.command(examplesCommand);
cli.command(campaignsCommand);
cli.command(listsCommand);
cli.command(subscribersCommand);
cli.command(templatesCommand);
cli.command(txCommand);
cli.command(abtestCommand);

await cli.run();
