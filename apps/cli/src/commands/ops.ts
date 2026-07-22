import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
	invokeCampaignPreflightOperation,
	invokeDailyDigestOperation,
	invokeDeliverabilityGuardOperation,
	invokeSegmentDriftOperation,
	invokeSubscriberHygieneOperation,
	invokeTemplateRegistryHistoryOperation,
	invokeTemplateRegistryPromoteOperation,
	invokeTemplateRegistryRollbackOperation,
	invokeTemplateRegistrySyncOperation,
} from "@listmonk-ops/automation";
import { OutputUtils } from "@listmonk-ops/common";
import { z } from "zod";
import { defineCommand, defineGroup, option } from "../lib/command";
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
			operationId: "ops.campaign.preflight",
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
					const result = await invokeCampaignPreflightOperation(
						{ client },
						{
							campaign_id: flags["campaign-id"],
							max_audience: flags["max-audience"],
							check_links: flags["check-links"],
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
			operationId: "ops.campaign.deliverability-guard",
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
					const result = await invokeDeliverabilityGuardOperation(
						{ client },
						{
							campaign_id: flags["campaign-id"],
							bounce_threshold: flags["bounce-threshold"],
							open_threshold: flags["open-threshold"],
							click_threshold: flags["click-threshold"],
							pause_on_breach: flags["pause-on-breach"],
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
			operationId: "ops.subscribers.hygiene",
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
					const result = await invokeSubscriberHygieneOperation(
						{ client },
						{
							mode: flags.mode,
							inactivity_days: flags["inactivity-days"],
							source_list_ids: sourceListIds,
							target_list_id: flags["target-list-id"],
							blocklist: flags.blocklist,
							dry_run: flags["dry-run"],
							max_subscribers: flags["max-subscribers"],
						},
					);

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
			operationId: "ops.segments.drift",
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
					const result = await invokeSegmentDriftOperation(
						{ client },
						{
							list_ids: listIds,
							threshold: flags.threshold,
							min_absolute_change: flags["min-absolute-change"],
							lookback_days: flags["lookback-days"],
						},
					);
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
			operationId: "ops.templates.registry-sync",
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
					const result = await invokeTemplateRegistrySyncOperation(
						{ client },
						{
							template_ids: templateIds,
							note: flags.note,
						},
					);
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
			operationId: "ops.templates.registry-history",
			description: "Show template version history from local registry",
			options: {
				"template-id": option(z.coerce.number().int().positive(), {
					description: "Template ID",
				}),
			},
			handler: async ({ flags }) => {
				try {
					const result = await invokeTemplateRegistryHistoryOperation(
						{},
						{ template_id: flags["template-id"] },
					);
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
			operationId: "ops.templates.registry-promote",
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
					const result = await invokeTemplateRegistryPromoteOperation(
						{ client },
						{
							template_id: flags["template-id"],
							version_id: flags["version-id"],
						},
					);
					OutputUtils.json(result);
				} catch (error) {
					throw new Error(`Template promote failed: ${toErrorMessage(error)}`);
				}
			},
		}),
		defineCommand({
			name: "templates-rollback",
			operationId: "ops.templates.registry-rollback",
			description: "Rollback template to previous stored version",
			options: {
				"template-id": option(z.coerce.number().int().positive(), {
					description: "Template ID",
				}),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const client = await getListmonkClient(args);
					const result = await invokeTemplateRegistryRollbackOperation(
						{ client },
						{ template_id: flags["template-id"] },
					);
					OutputUtils.json(result);
				} catch (error) {
					throw new Error(`Template rollback failed: ${toErrorMessage(error)}`);
				}
			},
		}),
		defineCommand({
			name: "digest",
			operationId: "ops.digest.daily",
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
					const digest = await invokeDailyDigestOperation(
						{ client },
						{ hours: flags.hours },
					);

					if (flags.output) {
						await writeTextFile(flags.output, `${digest.markdown}\n`);
					}

					if (flags["markdown-only"]) {
						console.log(digest.markdown);
						return;
					}

					OutputUtils.json({ ...digest, output: flags.output });
				} catch (error) {
					throw new Error(`Digest generation failed: ${toErrorMessage(error)}`);
				}
			},
		}),
	],
});
