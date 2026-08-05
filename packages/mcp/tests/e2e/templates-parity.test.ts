import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMCPTestSuite } from "../mcp-helper.js";
import { buildTestName, TEST_CONFIG } from "../setup.js";

const TESTS_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(TESTS_DIRECTORY, "../../../..");
const CLI_DIRECTORY = resolve(PROJECT_ROOT, "apps/cli");
const CLI_ENTRY = resolve(CLI_DIRECTORY, "src/index.ts");

type CliResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

type TemplateSummary = {
	id: number;
	is_default?: boolean;
};

type SetDefaultTemplateResult = {
	id: number;
	set_default: true;
};

type TemplateManifestResult = {
	schema_version: 1;
	dry_run: boolean;
	results: Array<{
		name: string;
		action: "create" | "update" | "unchanged";
		applied: boolean;
	}>;
};

function resolveCliE2eCredential(
	config: Pick<typeof TEST_CONFIG, "apiToken" | "password">,
): string {
	return config.apiToken || config.password;
}

function runCliSetDefaultTemplate(templateId: number): CliResult {
	const result = Bun.spawnSync(
		["bun", CLI_ENTRY, "templates", "set-default", "--id", String(templateId)],
		{
			cwd: CLI_DIRECTORY,
			env: {
				...process.env,
				BUN_FORCE_COLOR: "0",
				LISTMONK_API_URL: TEST_CONFIG.baseUrl,
				LISTMONK_USERNAME: TEST_CONFIG.username,
				LISTMONK_API_TOKEN: resolveCliE2eCredential(TEST_CONFIG),
			},
			stdout: "pipe",
			stderr: "pipe",
		},
	);

	return {
		exitCode: result.exitCode,
		stdout: result.stdout.toString().trim(),
		stderr: result.stderr.toString().trim(),
	};
}

function runCliReconcileTemplateManifest(
	manifestPath: string,
	options: { confirm: boolean; dryRun: boolean; stateDirectory: string },
): CliResult {
	const args = ["bun", CLI_ENTRY];
	if (options.confirm) args.push("--confirm");
	args.push(
		"templates",
		"reconcile",
		"--manifest-file",
		manifestPath,
		options.dryRun ? "--dry-run" : "--no-dry-run",
		"--format=json",
	);
	const result = Bun.spawnSync(args, {
		cwd: CLI_DIRECTORY,
		env: {
			...process.env,
			BUN_FORCE_COLOR: "0",
			LISTMONK_API_URL: TEST_CONFIG.baseUrl,
			LISTMONK_USERNAME: TEST_CONFIG.username,
			LISTMONK_API_TOKEN: resolveCliE2eCredential(TEST_CONFIG),
			LISTMONK_OPS_AUDIT_STORE: join(
				options.stateDirectory,
				"operation-audit.json",
			),
			LISTMONK_OPS_WEBHOOK_STORE: join(
				options.stateDirectory,
				"outbound-webhooks.json",
			),
		},
		stdout: "pipe",
		stderr: "pipe",
	});

	return {
		exitCode: result.exitCode,
		stdout: result.stdout.toString().trim(),
		stderr: result.stderr.toString().trim(),
	};
}

function parseCliTemplateOutput(result: CliResult): SetDefaultTemplateResult {
	const diagnosticOutput = [result.stdout, result.stderr]
		.filter(Boolean)
		.join("\n");
	if (result.exitCode !== 0) {
		throw new Error(
			`CLI template default selection failed with exit ${result.exitCode}: ${diagnosticOutput}`,
		);
	}

	const jsonStart = result.stdout.indexOf("{");
	if (jsonStart < 0) {
		throw new Error(
			`CLI template default selection did not return a JSON result: ${diagnosticOutput}`,
		);
	}

	const parsed = JSON.parse(
		result.stdout.slice(jsonStart),
	) as Partial<SetDefaultTemplateResult>;
	if (typeof parsed.id !== "number" || parsed.set_default !== true) {
		throw new Error(
			`CLI template default selection returned an invalid result: ${diagnosticOutput}`,
		);
	}
	return parsed as SetDefaultTemplateResult;
}

function parseCliManifestOutput(result: CliResult): TemplateManifestResult {
	const diagnosticOutput = [result.stdout, result.stderr]
		.filter(Boolean)
		.join("\n");
	if (result.exitCode !== 0) {
		throw new Error(
			`CLI template manifest reconciliation failed with exit ${result.exitCode}: ${diagnosticOutput}`,
		);
	}
	const jsonStart = result.stdout.indexOf("{");
	if (jsonStart < 0) {
		throw new Error(
			`CLI template manifest reconciliation did not return JSON: ${diagnosticOutput}`,
		);
	}
	return JSON.parse(result.stdout.slice(jsonStart)) as TemplateManifestResult;
}

function requireDefaultTemplate(
	templates: readonly TemplateSummary[] | undefined,
): TemplateSummary {
	const template = templates?.find(
		(candidate) => candidate.is_default === true && Number.isInteger(candidate.id),
	);
	if (!template) {
		throw new Error("Local Listmonk stack did not return a default template");
	}
	return template;
}

describe("Template default CLI and MCP parity", () => {
	const { client, utils } = createMCPTestSuite();

	test("selects a default template through both adapters and restores the local stack", async () => {
		const templatesResult = await client.callTool("listmonk_get_templates", {
			page: 1,
			per_page: 200,
			no_body: true,
		});
		const templates = utils.assertSuccess<{ results?: TemplateSummary[] }>(
			templatesResult,
			"Failed to list templates before CLI/MCP parity selection",
		);
		const originalDefault = requireDefaultTemplate(templates.results);
		const createdResult = await client.callTool("listmonk_create_template", {
			name: buildTestName("template-default-parity"),
			type: "campaign",
			subject: "CLI/MCP default template parity",
			body: '<html><body>{{ template "content" . }}</body></html>',
		});
		const created = utils.assertSuccess<TemplateSummary>(
			createdResult,
			"Failed to create template for CLI/MCP default parity",
		);

		try {
			const cliTemplate = parseCliTemplateOutput(
				runCliSetDefaultTemplate(created.id),
			);
			expect(cliTemplate).toEqual({ id: created.id, set_default: true });

			const mcpResult = await client.callTool("listmonk_set_default_template", {
				id: created.id,
			});
			utils.assertSuccess(
				mcpResult,
				"Failed to set the parity template through MCP",
			);
			expect(
				mcpResult.content.find((content) => content.type === "text")?.text,
			).toBe(
				"Default template set successfully",
			);
			expect(mcpResult.structuredContent).toEqual({
				id: created.id,
				set_default: true,
			});
		} finally {
			try {
				const restoreResult = await client.callTool(
					"listmonk_set_default_template",
					{ id: originalDefault.id },
				);
				utils.assertSuccess(
					restoreResult,
					"Failed to restore the original local default template",
				);
			} finally {
				const deleteResult = await client.callTool("listmonk_delete_template", {
					id: created.id,
					confirm: true,
				});
				utils.assertSuccess(
					deleteResult,
					"Failed to delete the CLI/MCP parity template after restoration",
				);
			}
		}
	});
});

describe("Template manifest CLI and MCP parity", () => {
	const { client, utils } = createMCPTestSuite();

	test("shares dry-run output, confirmation, and apply semantics", async () => {
		const stateDirectory = await mkdtemp(
			join(tmpdir(), "listmonk-ops-template-manifest-e2e-"),
		);
		const manifestPath = join(stateDirectory, "templates.json");
		const templateName = buildTestName("template-manifest-parity");
		const manifest = {
			schema_version: 1 as const,
			templates: [
				{
					name: templateName,
					type: "campaign" as const,
					subject: "Template manifest parity",
					body: '<html><body>{{ template "content" . }}</body></html>',
				},
			],
		};
		await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
		let createdId: number | undefined;

		try {
			const blocked = runCliReconcileTemplateManifest(manifestPath, {
				confirm: false,
				dryRun: true,
				stateDirectory,
			});
			expect(blocked.exitCode).not.toBe(0);
			expect(`${blocked.stdout}\n${blocked.stderr}`).toContain(
				"requires explicit confirmation",
			);

			const cliPlan = parseCliManifestOutput(
				runCliReconcileTemplateManifest(manifestPath, {
					confirm: true,
					dryRun: true,
					stateDirectory,
				}),
			);
			const mcpPlanResult = await client.callTool(
				"listmonk_reconcile_template_manifest",
				{ ...manifest, dry_run: true, confirm: true },
			);
			const mcpPlan = utils.assertSuccess<TemplateManifestResult>(
				mcpPlanResult,
				"Failed to plan the template manifest through MCP",
			);
			expect(cliPlan).toEqual(mcpPlan);

			const applyResult = await client.callTool(
				"listmonk_reconcile_template_manifest",
				{ ...manifest, dry_run: false, confirm: true },
			);
			const applied = utils.assertSuccess<TemplateManifestResult>(
				applyResult,
				"Failed to apply the template manifest through MCP",
			);
			expect(applied).toEqual({
				schema_version: 1,
				dry_run: false,
				results: [
					{ name: templateName, action: "create", applied: true },
				],
			});

			const templatesResult = await client.callTool("listmonk_get_templates", {
				page: 1,
				per_page: 500,
				no_body: true,
			});
			const templates = utils.assertSuccess<{ results?: TemplateSummary[] }>(
				templatesResult,
				"Failed to resolve the reconciled template",
			);
			createdId = templates.results?.find(
				(template) =>
					(template as TemplateSummary & { name?: string }).name === templateName,
			)?.id;
			expect(createdId).toBeDefined();
		} finally {
			try {
				if (createdId !== undefined) {
					const deleteResult = await client.callTool("listmonk_delete_template", {
						id: createdId,
						confirm: true,
					});
					utils.assertSuccess(
						deleteResult,
						"Failed to delete the reconciled parity template",
					);
				}
			} finally {
				await rm(stateDirectory, { recursive: true, force: true });
			}
		}
	});
});
