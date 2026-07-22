import { describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMCPTestSuite } from "../mcp-helper.js";
import { buildTestName, createTestClient, TEST_CONFIG } from "../setup.js";

const TESTS_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(TESTS_DIRECTORY, "../../../..");
const CLI_DIRECTORY = resolve(PROJECT_ROOT, "apps/cli");
const CLI_ENTRY = resolve(CLI_DIRECTORY, "src/index.ts");
const TRANSPARENT_GIF = Uint8Array.from([
	71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 33,
	249, 4, 1, 0, 0, 0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59,
]);

type CliResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

type MediaSummary = {
	id: number;
	filename?: string;
	content_type?: string;
};

type DeleteMediaResult = {
	id: number;
	deleted: boolean;
};

function resolveCliE2eCredential(
	config: Pick<typeof TEST_CONFIG, "apiToken" | "password">,
): string {
	return config.apiToken || config.password;
}

function testAuthorizationHeader(): string {
	return `token ${TEST_CONFIG.username}:${resolveCliE2eCredential(TEST_CONFIG)}`;
}

function runCliGetMediaFile(mediaId: number): CliResult {
	return runCliMediaCommand(["get", "--id", String(mediaId)]);
}

function runCliDeleteMedia(mediaId: number): CliResult {
	return runCliMediaCommand(["delete", "--id", String(mediaId), "--confirm"]);
}

function runCliMediaCommand(args: string[]): CliResult {
	const result = Bun.spawnSync(["bun", CLI_ENTRY, "media", ...args], {
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
			`CLI media ${operation} failed with exit ${result.exitCode}: ${diagnosticOutput}`,
		);
	}

	const jsonStart = result.stdout.indexOf("{");
	if (jsonStart < 0) {
		throw new Error(
			`CLI media ${operation} did not return a JSON result: ${diagnosticOutput}`,
		);
	}
	return JSON.parse(result.stdout.slice(jsonStart)) as T;
}

function requireMediaSummary(value: Partial<MediaSummary>): MediaSummary {
	if (!Number.isInteger(value.id)) {
		throw new Error("Local Listmonk media upload did not return a numeric ID");
	}
	return value as MediaSummary;
}

async function uploadMediaFixture(): Promise<MediaSummary> {
	const filename = `${buildTestName("media-parity")}.gif`;
	const file = new File([TRANSPARENT_GIF], filename, { type: "image/gif" });
	const formData = new FormData();
	formData.append("file", file);

	// Listmonk's live endpoint requires a multipart `file` field while the
	// upstream OpenAPI spec currently models the request as a raw binary body.
	// Keep that mismatch out of production contracts: this is fixture setup
	// only, bounded to the loopback-protected Compose test stack.
	const response = await fetch(`${TEST_CONFIG.baseUrl}/media`, {
		method: "POST",
		headers: { Authorization: testAuthorizationHeader() },
		body: formData,
	});
	if (!response.ok) {
		throw new Error(
			`Local media fixture upload failed with HTTP ${response.status}`,
		);
	}

	const payload = (await response.json()) as { data?: Partial<MediaSummary> };
	return requireMediaSummary(payload.data ?? {});
}

async function assertMediaDeleted(mediaId: number): Promise<void> {
	const response = await createTestClient().media.getById({
		path: { id: mediaId },
	});
	expect("error" in response && response.error !== undefined).toBe(true);
}

async function deleteMediaIfPresent(mediaId: number | undefined): Promise<void> {
	if (mediaId === undefined) return;
	try {
		await createTestClient().media.deleteById({ path: { id: mediaId } });
	} catch {
		// The requested delete may already have succeeded through CLI or MCP.
	}
}

describe("Media CLI and MCP parity", () => {
	const { client, utils } = createMCPTestSuite();

	test("reads the same fixture through both adapters and enforces destructive confirmation", async () => {
		let cliMediaId: number | undefined;
		let mcpMediaId: number | undefined;

		try {
			const cliFixture = await uploadMediaFixture();
			cliMediaId = cliFixture.id;
			const blockedCliDeletion = runCliMediaCommand([
				"delete",
				"--id",
				String(cliFixture.id),
			]);
			expect(blockedCliDeletion.exitCode).not.toBe(0);
			expect(`${blockedCliDeletion.stdout}${blockedCliDeletion.stderr}`).toContain(
				"requires explicit confirmation",
			);
			const blockedMcpDeletion = await client.callTool(
				"listmonk_delete_media",
				{ id: cliFixture.id },
			);
			utils.assertError(
				blockedMcpDeletion,
				"requires explicit confirmation",
			);

			const cliMedia = requireMediaSummary(
				parseCliJson<Partial<MediaSummary>>(
					runCliGetMediaFile(cliFixture.id),
					"get",
				),
			);
			const mcpResult = await client.callTool("listmonk_get_media_file", {
				id: cliFixture.id,
			});
			const mcpMedia = requireMediaSummary(
				utils.assertSuccess<Partial<MediaSummary>>(
					mcpResult,
					"Failed to read the media fixture through MCP",
				),
			);
			expect({ id: cliMedia.id, filename: cliMedia.filename }).toEqual({
				id: mcpMedia.id,
				filename: mcpMedia.filename,
			});

			const cliDeletion = parseCliJson<DeleteMediaResult>(
				runCliDeleteMedia(cliFixture.id),
				"delete",
			);
			expect(cliDeletion).toEqual({ id: cliFixture.id, deleted: true });
			await assertMediaDeleted(cliFixture.id);
			cliMediaId = undefined;

			const mcpFixture = await uploadMediaFixture();
			mcpMediaId = mcpFixture.id;
			const mcpDeletion = await client.callTool("listmonk_delete_media", {
				id: mcpFixture.id,
				confirm: true,
			});
			utils.assertSuccess(
				mcpDeletion,
				"Failed to delete the media fixture through MCP",
			);
			expect(mcpDeletion.structuredContent).toEqual({
				id: mcpFixture.id,
				deleted: true,
			});
			expect(mcpDeletion.content[0]?.text).toBe(
				"Media file deleted successfully",
			);
			await assertMediaDeleted(mcpFixture.id);
			mcpMediaId = undefined;
		} finally {
			await deleteMediaIfPresent(cliMediaId);
			await deleteMediaIfPresent(mcpMediaId);
		}
	});
});
