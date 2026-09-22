import { describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMCPTestSuite } from "../mcp-helper.js";
import { buildTestName, createTestClient, TEST_CONFIG } from "../setup.js";

const TESTS_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(TESTS_DIRECTORY, "../../../..");
const CLI_DIRECTORY = resolve(PROJECT_ROOT, "apps/cli");
const CLI_ENTRY = resolve(CLI_DIRECTORY, "src/index.ts");

type CliResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

function resolveCliE2eCredential(
	config: Pick<typeof TEST_CONFIG, "apiToken" | "password">,
): string {
	return config.apiToken || config.password;
}

function runCliCampaignCommand(args: string[]): CliResult {
	const result = Bun.spawnSync(["bun", CLI_ENTRY, "campaigns", ...args], {
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
	});

	return {
		exitCode: result.exitCode,
		stdout: result.stdout.toString().trim(),
		stderr: result.stderr.toString().trim(),
	};
}

type CampaignPage = { results: Array<{ id: number; tags: string[] }>; total: number };

describe("Campaign tag filter CLI/MCP parity", () => {
	const { client, utils } = createMCPTestSuite();

	test("filters one, multiple and nonmatching tags, excluding untagged campaigns", async () => {
		const api = createTestClient();
		const prefix = buildTestName("tag-filter");
		const tags = [`${prefix}-a`, `${prefix}-b`];
		const ids: number[] = [];
		try {
			for (const [index, campaignTags] of [[tags[0]!], [tags[1]!], [], tags].entries()) {
				const response = await api.campaign.create({ body: {
					name: `${prefix}-${index}`, subject: prefix, lists: [1],
					content_type: "html", template_id: 1, messenger: "email",
					type: "regular", body: "<p>Filter fixture</p>", tags: campaignTags,
				} });
				if (response.error || !response.data?.id) throw new Error("Campaign fixture creation failed");
				ids.push(response.data.id);
			}
			for (const [filter, expected] of [
				[[tags[0]!], [ids[0]!, ids[3]!]],
				[tags, [ids[3]!]],
				[[`${prefix}-missing`], []],
			] as Array<[string[], number[]]>) {
				const direct = await api.campaign.list({ query: { tags: filter, per_page: 20 } });
				if (direct.error) throw new Error("Direct campaign filter failed");
				const mcp = utils.assertSuccess<CampaignPage>(await client.callTool("listmonk_get_campaigns", {
					tags: filter, page: 1, per_page: 20,
				}));
				const cli = runCliCampaignCommand([
					"--format", "json", "list", "--tags", filter.join(","), "--page", "1", "--per-page", "20",
				 ]);
				expect(cli.exitCode).toBe(0);
				// The list CLI emits rows only; an empty page is an info message on stderr.
				const jsonStart = cli.stdout.indexOf("[");
				const cliRows = jsonStart >= 0 ? JSON.parse(cli.stdout.slice(jsonStart)) as CampaignPage["results"] : [];
				if (jsonStart < 0) expect(cli.stderr).toContain("No campaigns found");
				expect(cliRows.map((row) => row.id).sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b));
				for (const result of [direct.data, mcp]) {
					expect(result.total).toBe(expected.length);
					expect(result.results.map((row) => row.id).sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b));
					for (const row of result.results) expect(filter.every((tag) => row.tags.includes(tag))).toBe(true);
				}
			}
		} finally {
			for (const id of ids) await api.campaign.delete({ path: { id } });
		}
	});
});
