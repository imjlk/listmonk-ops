import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { defineCommand, defineGroup, option } from "@bunli/core";
import { OutputUtils } from "@listmonk-ops/common";
import {
	evaluateDeliverabilityGuard,
	generateDailyDigest,
	getOpsStorePaths,
	getTemplateRegistryHistory,
	promoteTemplateVersion,
	rollbackTemplateVersion,
	runCampaignPreflight,
	runSegmentDriftSnapshot,
	runSubscriberHygiene,
	syncTemplateRegistry,
} from "@listmonk-ops/automation";
import { z } from "zod";

import { parseCsvNumbers, toErrorMessage } from "../lib/command-utils";
import { getListmonkClient } from "../lib/listmonk";

async function writeTextFile(path: string, content: string) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content, "utf8");
}

export default defineGroup({
	name: "ops",
	description: "Operational automation and safety tooling",
	commands: [
		defineCommand({
			name: "preflight",
			description: "Run pre-send campaign preflight checks",
			options: {
				"campaign-id": option(z.coerce.number().int().positive(), {
					description: "Campaign ID",
				}),
				"max-audience": option(z.coerce.number().int().positive().optional(), {
					description: "Warning threshold for audience size",
				}),
				"check-links": option(z.coerce.boolean().default(false), {
					description: "Check outbound links in campaign body",
				}),
				"fail-on-warn": option(z.coerce.boolean().default(false), {
					description: "Treat warnings as failures",
				}),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const client = await getListmonkClient(args);
					const result = await runCampaignPreflight(
						client,
						flags["campaign-id"],
						{
							maxAudience: flags["max-audience"],
							checkLinks: flags["check-links"],
						},
					);
					OutputUtils.json(result);

					if (
						result.summary.fail > 0 ||
						(flags["fail-on-warn"] && result.summary.warn > 0)
					) {
						throw new Error(
							`Preflight failed (fail=${result.summary.fail}, warn=${result.summary.warn})`,
						);
					}
				} catch (error) {
					throw new Error(`Preflight check failed: ${toErrorMessage(error)}`);
				}
			},
		}),
		defineCommand({
			name: "guard",
			description:
				"Evaluate deliverability guard and optionally pause campaign",
			options: {
				"campaign-id": option(z.coerce.number().int().positive(), {
					description: "Campaign ID",
				}),
				"bounce-threshold": option(
					z.coerce.number().min(0).max(1).default(0.05),
					{
						description: "Max allowed bounce rate",
					},
				),
				"open-threshold": option(
					z.coerce.number().min(0).max(1).default(0.08),
					{
						description: "Min required open rate",
					},
				),
				"click-threshold": option(
					z.coerce.number().min(0).max(1).default(0.01),
					{
						description: "Min required click rate",
					},
				),
				"pause-on-breach": option(z.coerce.boolean().default(false), {
					description: "Pause running/scheduled campaign on breach",
				}),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const client = await getListmonkClient(args);
					const result = await evaluateDeliverabilityGuard(
						client,
						flags["campaign-id"],
						{
							bounceThreshold: flags["bounce-threshold"],
							openRateThreshold: flags["open-threshold"],
							clickRateThreshold: flags["click-threshold"],
							pauseOnBreach: flags["pause-on-breach"],
						},
					);

					OutputUtils.json(result);
				} catch (error) {
					throw new Error(
						`Deliverability guard failed: ${toErrorMessage(error)}`,
					);
				}
			},
		}),
		defineCommand({
			name: "hygiene",
			description: "Run subscriber hygiene workflow (winback/sunset)",
			options: {
				mode: option(z.enum(["winback", "sunset"]).default("winback"), {
					description: "Hygiene mode",
				}),
				"inactivity-days": option(
					z.coerce.number().int().positive().default(90),
					{
						description: "Inactive threshold in days",
					},
				),
				"source-list-ids": option(z.string().trim().optional(), {
					description: "Restrict candidates to these list IDs (csv)",
				}),
				"target-list-id": option(
					z.coerce.number().int().positive().optional(),
					{
						description: "Target list ID for winback/sunset tagging",
					},
				),
				blocklist: option(z.coerce.boolean().default(false), {
					description: "Blocklist sunset candidates",
				}),
				"dry-run": option(z.coerce.boolean().default(true), {
					description: "Preview candidates without mutating subscribers",
				}),
				"max-subscribers": option(
					z.coerce.number().int().positive().default(500),
					{
						description: "Max candidates to process in one run",
					},
				),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const client = await getListmonkClient(args);
					const sourceListIds = flags["source-list-ids"]
						? parseCsvNumbers(flags["source-list-ids"])
						: undefined;
					const result = await runSubscriberHygiene(client, {
						mode: flags.mode,
						inactivityDays: flags["inactivity-days"],
						sourceListIds,
						targetListId: flags["target-list-id"],
						blocklist: flags.blocklist,
						dryRun: flags["dry-run"],
						maxSubscribers: flags["max-subscribers"],
					});

					OutputUtils.json(result);
				} catch (error) {
					throw new Error(
						`Subscriber hygiene failed: ${toErrorMessage(error)}`,
					);
				}
			},
		}),
		defineCommand({
			name: "segment-drift",
			description: "Snapshot list sizes and detect segment drift",
			options: {
				"list-ids": option(z.string().trim().optional(), {
					description: "Specific list IDs to monitor (csv)",
				}),
				threshold: option(z.coerce.number().min(0).default(0.2), {
					description: "Relative drift threshold (0.2 = 20%)",
				}),
				"min-absolute-change": option(
					z.coerce.number().int().min(0).default(50),
					{
						description: "Minimum absolute subscriber delta for alert",
					},
				),
				"lookback-days": option(
					z.coerce.number().int().positive().default(14),
					{
						description: "Baseline lookback window (days)",
					},
				),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const client = await getListmonkClient(args);
					const listIds = flags["list-ids"]
						? parseCsvNumbers(flags["list-ids"])
						: undefined;
					const result = await runSegmentDriftSnapshot(client, {
						listIds,
						threshold: flags.threshold,
						minAbsoluteChange: flags["min-absolute-change"],
						lookbackDays: flags["lookback-days"],
					});
					OutputUtils.json(result);
				} catch (error) {
					throw new Error(
						`Segment drift snapshot failed: ${toErrorMessage(error)}`,
					);
				}
			},
		}),
		defineCommand({
			name: "templates-sync",
			description: "Sync Listmonk templates into local version registry",
			options: {
				"template-ids": option(z.string().trim().optional(), {
					description: "Template IDs to sync (csv). Omit for all templates",
				}),
				note: option(z.string().trim().optional(), {
					description: "Optional note stored with this snapshot",
				}),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const client = await getListmonkClient(args);
					const templateIds = flags["template-ids"]
						? parseCsvNumbers(flags["template-ids"])
						: undefined;
					const result = await syncTemplateRegistry(client, {
						templateIds,
						note: flags.note,
					});
					OutputUtils.json(result);
				} catch (error) {
					throw new Error(
						`Template registry sync failed: ${toErrorMessage(error)}`,
					);
				}
			},
		}),
		defineCommand({
			name: "templates-history",
			description: "Show template version history from local registry",
			options: {
				"template-id": option(z.coerce.number().int().positive(), {
					description: "Template ID",
				}),
			},
			handler: async ({ flags }) => {
				try {
					const result = await getTemplateRegistryHistory(flags["template-id"]);
					OutputUtils.json(result);
				} catch (error) {
					throw new Error(
						`Template registry history failed: ${toErrorMessage(error)}`,
					);
				}
			},
		}),
		defineCommand({
			name: "templates-promote",
			description: "Promote a stored template version to active content",
			options: {
				"template-id": option(z.coerce.number().int().positive(), {
					description: "Template ID",
				}),
				"version-id": option(z.string().trim().min(1), {
					description: "Stored version ID",
				}),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const client = await getListmonkClient(args);
					const result = await promoteTemplateVersion(
						client,
						flags["template-id"],
						flags["version-id"],
					);
					OutputUtils.json(result);
				} catch (error) {
					throw new Error(`Template promote failed: ${toErrorMessage(error)}`);
				}
			},
		}),
		defineCommand({
			name: "templates-rollback",
			description: "Rollback template to previous stored version",
			options: {
				"template-id": option(z.coerce.number().int().positive(), {
					description: "Template ID",
				}),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const client = await getListmonkClient(args);
					const result = await rollbackTemplateVersion(
						client,
						flags["template-id"],
					);
					OutputUtils.json(result);
				} catch (error) {
					throw new Error(`Template rollback failed: ${toErrorMessage(error)}`);
				}
			},
		}),
		defineCommand({
			name: "digest",
			description: "Generate daily operations digest",
			options: {
				hours: option(z.coerce.number().int().positive().default(24), {
					description: "Lookback window in hours",
				}),
				output: option(z.string().trim().optional(), {
					description: "Optional output path for markdown digest",
				}),
				"markdown-only": option(z.coerce.boolean().default(false), {
					description: "Print markdown only (no JSON envelope)",
				}),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const client = await getListmonkClient(args);
					const digest = await generateDailyDigest(client, {
						hours: flags.hours,
					});

					if (flags.output) {
						await writeTextFile(flags.output, `${digest.markdown}\n`);
					}

					if (flags["markdown-only"]) {
						console.log(digest.markdown);
						return;
					}

					OutputUtils.json({
						...digest,
						storePaths: getOpsStorePaths(),
						output: flags.output,
					});
				} catch (error) {
					throw new Error(`Digest generation failed: ${toErrorMessage(error)}`);
				}
			},
		}),
	],
});
