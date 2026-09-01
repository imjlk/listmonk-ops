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

type CampaignPreview = {
	html?: string;
};

type CampaignTestResult = {
	id: number;
	subscribers: string[];
	sent: boolean;
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

function parseCliJson<T>(result: CliResult, operation: string): T {
	const diagnosticOutput = [result.stdout, result.stderr]
		.filter(Boolean)
		.join("\n");
	if (result.exitCode !== 0) {
		throw new Error(
			`CLI campaigns ${operation} failed with exit ${result.exitCode}: ${diagnosticOutput}`,
		);
	}

	const jsonStart = result.stdout.indexOf("{");
	if (jsonStart < 0) {
		throw new Error(
			`CLI campaigns ${operation} did not return a JSON result: ${diagnosticOutput}`,
		);
	}
	return JSON.parse(result.stdout.slice(jsonStart)) as T;
}

/**
 * Provision a uniquely named draft campaign whose test send can be
 * asserted in Mailpit, and clean it up afterwards.
 */
async function createDraftCampaignFixture(): Promise<{
	id: number;
	subject: string;
}> {
	const name = buildTestName("campaign-preview-test");
	const response = await fetch(`${TEST_CONFIG.baseUrl}/campaigns`, {
		method: "POST",
		headers: {
			Authorization: `token ${TEST_CONFIG.username}:${resolveCliE2eCredential(TEST_CONFIG)}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			name,
			subject: name,
			lists: [1],
			content_type: "html",
			template_id: 1,
			messenger: "email",
			type: "regular",
			body: `<p>${name} body</p>`,
		}),
	});
	if (!response.ok) {
		throw new Error(
			`Campaign fixture creation failed with HTTP ${response.status}`,
		);
	}
	const payload = (await response.json()) as { data?: { id?: number } };
	const id = payload.data?.id;
	if (!Number.isInteger(id)) {
		throw new Error("Campaign fixture did not return a numeric id");
	}
	return { id, subject: name };
}

async function deleteCampaignFixture(id: number): Promise<void> {
	try {
		await createTestClient().campaign.deleteById({ path: { id } });
	} catch {
		// The fixture may already be gone.
	}
}

describe("Campaign preview and test CLI/MCP parity", () => {
	const { client, utils } = createMCPTestSuite();

	test("renders the same preview through both adapters", async () => {
		const fixtureId = (await createDraftCampaignFixture()).id;
		try {
			const cliPreview = parseCliJson<CampaignPreview>(
				runCliCampaignCommand([
					"--format",
					"json",
					"preview",
					"--id",
					String(fixtureId),
				]),
				"preview",
			);
			expect(cliPreview.html).toBeTruthy();

			const mcpPreview = utils.assertSuccess<CampaignPreview>(
				await client.callTool("listmonk_preview_campaign", {
					id: fixtureId,
				}),
				"Failed to preview the campaign through MCP",
			);
			expect(mcpPreview.html).toBe(cliPreview.html);
		} finally {
			await deleteCampaignFixture(fixtureId);
		}
	});

	test("sends a confirmed test message through both adapters and delivers it", async () => {
		const fixture = await createDraftCampaignFixture();
		const fixtureId = fixture.id;
		// Reuse an existing enabled subscriber of list 1 as the recipient;
		// the endpoint rejects unknown emails.
		const subscribersResponse = await createTestClient().subscriber.list({
			query: { list_id: [1], page: 1, per_page: 1 },
		});
		const recipient = (subscribersResponse.data?.results ?? [])[0]?.email;
		if (!recipient) {
			throw new Error("No enabled subscriber in list 1 for the test send");
		}

		try {
			const cliResult = parseCliJson<CampaignTestResult>(
				runCliCampaignCommand([
					"--format",
					"json",
					"test",
					"--id",
					String(fixtureId),
					"--subscribers",
					recipient,
				]),
				"test",
			);
			expect(cliResult).toEqual({
				id: fixtureId,
				subscribers: [recipient.toLowerCase()],
				sent: true,
			});

			const mcpResult = utils.assertSuccess<CampaignTestResult>(
				await client.callTool("listmonk_test_campaign", {
					id: fixtureId,
					subscribers: [recipient],
				}),
				"Failed to send the campaign test through MCP",
			);
			expect(mcpResult.sent).toBe(true);

			// Both sends must have delivered through Mailpit. The subject is
			// the fixture name, which is unique per run. Listmonk dispatches
			// test sends through its async message queue, so poll briefly.
			const fixtureSubject = fixture.subject;
			const mailpitBase =
				process.env.MAILPIT_API_URL ?? "http://127.0.0.1:8025/api/v1";
			let deliveredCount = 0;
			for (let attempt = 0; attempt < 20 && deliveredCount < 2; attempt += 1) {
				await new Promise((resolve) => setTimeout(resolve, 500));
				const mailpitResponse = await fetch(
					`${mailpitBase}/search?query=${encodeURIComponent(`subject:"${fixtureSubject}"`)}`,
				);
				const search = (await mailpitResponse.json()) as {
					messages?: { Subject?: string; To?: { Address: string }[] }[];
				};
				deliveredCount = (search.messages ?? []).filter((message) =>
					message.To?.some((to) => to.Address === recipient.toLowerCase()),
				).length;
			}
			expect(deliveredCount).toBeGreaterThanOrEqual(2);
		} finally {
			await deleteCampaignFixture(fixtureId);
		}
	});

	test("reads the same analytics rows through both adapters", async () => {
		const cliAnalytics = parseCliJson<{
			type?: string;
			campaign_ids?: number[];
			results?: unknown[];
		}>(
			runCliCampaignCommand([
				"--format",
				"json",
				"analytics",
				"--type",
				"views",
				"--from",
				"2026-08-01",
				"--to",
				"2026-09-30",
				"--campaign-ids",
				"1",
			]),
			"analytics",
		);
		expect(cliAnalytics.type).toBe("views");
		expect(cliAnalytics.campaign_ids).toEqual([1]);

		const mcpAnalytics = utils.assertSuccess<{
			type?: string;
			campaign_ids?: number[];
			results?: unknown[];
		}>(
			await client.callTool("listmonk_get_campaign_analytics", {
				type: "views",
				from: "2026-08-01",
				to: "2026-09-30",
				campaign_ids: [1],
			}),
			"Failed to read analytics through MCP",
		);
		expect(mcpAnalytics.type).toBe("views");
		expect(mcpAnalytics.results).toEqual(cliAnalytics.results);
	});

	test("rejects unknown recipients identically on both adapters", async () => {
		const fixtureId = (await createDraftCampaignFixture()).id;
		try {
			const cliFailure = runCliCampaignCommand([
				"test",
				"--id",
				String(fixtureId),
				"--subscribers",
				"unknown-recipient@nowhere.example",
			]);
			expect(cliFailure.exitCode).not.toBe(0);

			const mcpFailure = await client.callTool("listmonk_test_campaign", {
				id: fixtureId,
				subscribers: ["unknown-recipient@nowhere.example"],
			});
			utils.assertError(mcpFailure);
		} finally {
			await deleteCampaignFixture(fixtureId);
		}
	});
});
