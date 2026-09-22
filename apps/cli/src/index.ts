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
import capabilitiesCommand from "./commands/capabilities";
import campaignsCommand from "./commands/campaigns";
import dashboardCommand from "./commands/dashboard";
import deliverabilityCommand from "./commands/deliverability";
import examplesCommand from "./commands/examples";
import listsCommand from "./commands/lists";
import maintenanceCommand from "./commands/maintenance";
import mediaCommand from "./commands/media";
import opsCommand from "./commands/ops";
import operationsCommand from "./commands/operations";
import playbooksCommand from "./commands/playbooks";
import primeCommand from "./commands/prime";
import providersCommand from "./commands/providers";
import specsCommand from "./commands/specs";
import statusCommand from "./commands/status";
import sequencesCommand from "./commands/sequences";
import settingsCommand from "./commands/settings";
import subscribersCommand from "./commands/subscribers";
import systemCommand from "./commands/system";
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
	system: systemCommand,
	settings: settingsCommand,
	maintenance: maintenanceCommand,
	providers: providersCommand,
	deliverability: deliverabilityCommand,
	sequences: sequencesCommand,
	capabilities: capabilitiesCommand,
	prime: primeCommand,
	examples: examplesCommand,
	bounces: bouncesCommand,
	dashboard: dashboardCommand,
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

import {
	captureCliDiagnostics,
	renderCliDiagnostics,
	renderCliError,
} from "./lib/output";

let commandError: unknown;
let diagnostics: ReturnType<typeof captureCliDiagnostics> | undefined;
try {
	const argv = prepareCliArgv(process.argv.slice(2));
	const flags = getRuntimeFlags();
	const machineOutput = flags.format !== undefined && flags.format !== "human";
	if (machineOutput) {
		diagnostics = captureCliDiagnostics({ stream: flags.format === "ndjson" });
		process.env.LISTMONK_OPS_ABTEST_SILENT = "1";
		const helpRequested = argv.includes("--help") || argv.includes("-h") || argv.includes("--version");
		if (!helpRequested && (flags.interactive || flags.tui || (argv[0] === "abtest" && argv[1] === "interactive"))) {
			throw new Error("Interactive prompts require --format human.");
		}
	}
	await cli(argv, entry, {
		name: "listmonk-cli",
		version: packageJson.version,
		description: "CLI for Listmonk operations",
		strict: true,
		subCommands,
		plugins: [completion()],
		...(machineOutput ? { renderHeader: null } : {}),
		// Errors are rendered once at this boundary, never as stdout help or a Bun stack dump.
		renderValidationErrors: null,
	});
} catch (error) {
	commandError = error;
} finally {
	const closeResults = await Promise.allSettled([
		closeOutboundWebhookRuntimeRepositories(),
		closeSequenceRuntimeRepositories(),
	]);
	const closeFailures = closeResults
		.filter((result): result is PromiseRejectedResult => result.status === "rejected")
		.map((result) => result.reason);
	if (closeFailures.length > 0) {
		commandError = new AggregateError(
			commandError === undefined ? closeFailures : [commandError, ...closeFailures],
			"Failed to close one or more runtime repositories",
		);
	}
	diagnostics?.restore();
}
if (commandError !== undefined) {
	renderCliError(commandError, diagnostics);
	process.exitCode = 1;
} else {
	renderCliDiagnostics(diagnostics);
}
