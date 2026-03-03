#!/usr/bin/env bun

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCLI } from "@bunli/core";
import { completionsPlugin } from "@bunli/plugin-completions";

import abtestCommand from "./commands/abtest";
import campaignsCommand from "./commands/campaigns";
import examplesCommand from "./commands/examples";
import listsCommand from "./commands/lists";
import opsCommand from "./commands/ops";
import statusCommand from "./commands/status";
import subscribersCommand from "./commands/subscribers";
import templatesCommand from "./commands/templates";
import txCommand from "./commands/tx";

function resolveCompletionsGeneratedPath(): string {
	// Standalone binaries run from $bunfs. Keep metadata beside the executable.
	if (import.meta.url.includes("/$bunfs/")) {
		return resolve(dirname(process.execPath), "commands.runtime.mjs");
	}

	return fileURLToPath(
		new URL("../.bunli/commands.runtime.mjs", import.meta.url),
	);
}

const cli = await createCLI({
	name: "listmonk-cli",
	version: "0.2.0",
	description: "CLI for Listmonk operations",
	plugins: [
		completionsPlugin({
			generatedPath: resolveCompletionsGeneratedPath(),
			commandName: "listmonk-cli",
			executable: "listmonk-cli",
			includeAliases: true,
			includeGlobalFlags: true,
		}),
	],
});

cli.command(statusCommand);
cli.command(examplesCommand);
cli.command(campaignsCommand);
cli.command(listsCommand);
cli.command(subscribersCommand);
cli.command(templatesCommand);
cli.command(txCommand);
cli.command(abtestCommand);
cli.command(opsCommand);

await cli.run();
