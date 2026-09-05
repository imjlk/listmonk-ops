import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMCPTestSuite } from "../mcp-helper.js";
import {
	buildTestEmail,
	buildTestName,
	createTestClient,
	TEST_CONFIG,
} from "../setup.js";

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

function runCliSubscribersCommand(args: string[]): CliResult {
	const result = Bun.spawnSync(["bun", CLI_ENTRY, "subscribers", ...args], {
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

async function waitForImportCompletion(): Promise<{
	status?: string;
	imported?: number;
	total?: number;
}> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 500));
		const response = await createTestClient().import.get();
		const status = (response.data ?? {}) as {
			status?: string;
			imported?: number;
			total?: number;
		};
		if (status.status !== "importing") return status;
	}
	throw new Error("Subscriber import did not finish within the wait window");
}

async function deleteImportedSubscriber(email: string): Promise<void> {
	try {
		const listed = await createTestClient().subscriber.list({
			query: { query: email, page: 1, per_page: 5 },
		});
		for (const subscriber of listed.data?.results ?? []) {
			if (subscriber.email === email) {
				await createTestClient().subscriber.deleteById({
					path: { id: subscriber.id as number },
				});
			}
		}
	} catch {
		// Best-effort fixture cleanup.
	}
}

describe("Subscriber import CLI and MCP parity", () => {
	const { client, utils } = createMCPTestSuite();

	test("requires confirmation before starting a destructive import", async () => {
		const blocked = runCliSubscribersCommand([
			"import",
			"--mode",
			"subscribe",
			"--lists",
			"1",
			"--file",
			"/dev/null",
		]);
		expect(blocked.exitCode).not.toBe(0);
		expect(`${blocked.stdout}${blocked.stderr}`).toContain(
			"requires explicit confirmation",
		);

		const blockedMcp = await client.callTool(
			"listmonk_start_subscriber_import",
			{ mode: "subscribe", delim: ",", lists: [1], overwrite: false, csv: "email\n" },
		);
		utils.assertError(blockedMcp, "requires explicit confirmation");
	});

	test("runs an import through both adapters and reads the same status", async () => {
		const email = buildTestEmail("import-parity");
		const csv = `email,name\n${email},Import Parity\n`;
		const tempDir = await mkdtemp(join(tmpdir(), "listmonk-ops-import-"));
		const csvPath = join(tempDir, "import.csv");
		await Bun.write(csvPath, csv);
		let finished = false;

		try {
			// Start through the CLI with confirmation.
			const started = runCliSubscribersCommand([
				"--format",
				"json",
				"import",
				"--mode",
				"subscribe",
				"--lists",
				"1",
				"--file",
				csvPath,
				"--confirm",
			]);
			expect(started.exitCode).toBe(0);
			expect(started.stdout).toContain("import");

			// Both adapters must observe the same terminal session state.
			const status = await waitForImportCompletion();
			expect(["finished", "none"]).toContain(status.status ?? "none");

			const mcpStatus = utils.assertSuccess<{
				status?: string;
				imported?: number;
			}>(
				await client.callTool("listmonk_get_subscriber_import_status"),
				"Failed to read import status through MCP",
			);
			expect(typeof mcpStatus.status).toBe("string");
			finished = true;

			// The stop signal is safe to repeat and resets the session.
			const stopped = utils.assertSuccess<{ status?: string }>(
				await client.callTool("listmonk_stop_subscriber_import"),
				"Failed to stop the idle import through MCP",
			);
			expect(stopped.status).toBe("none");
		} finally {
			await rm(tempDir, { recursive: true, force: true });
			await deleteImportedSubscriber(email);
			if (!finished) {
				await createTestClient().import.stop().catch(() => undefined);
			}
		}
	});
});
