import { describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
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

function resolveCliE2eCredential(
	config: Pick<typeof TEST_CONFIG, "apiToken" | "password">,
): string {
	return config.apiToken || config.password;
}

function runCliSetDefaultTemplate(templateId: number): CliResult {
	const result = Bun.spawnSync(
		[
			"bun",
			CLI_ENTRY,
			"templates",
			"set-default",
			"--id",
			String(templateId),
		],
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
