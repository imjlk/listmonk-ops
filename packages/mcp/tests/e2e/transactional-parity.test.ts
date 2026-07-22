import { describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	fetchMailpitJson,
	findMailpitMessage,
	type MailpitMessage,
	type MailpitMessageSummary,
} from "./mailpit.js";
import { createMCPTestSuite } from "../mcp-helper.js";
import { buildTestEmail, buildTestName, TEST_CONFIG } from "../setup.js";

const TESTS_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(TESTS_DIRECTORY, "../../../..");
const CLI_DIRECTORY = resolve(PROJECT_ROOT, "apps/cli");
const CLI_ENTRY = resolve(CLI_DIRECTORY, "src/index.ts");
const HEADER_NAME = "X-Listmonk-Ops-Test";

type CliResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

type TransactionalCliInput = {
	templateId: number;
	recipient: string;
	traceId: string;
};

function resolveCliE2eCredential(
	config: Pick<typeof TEST_CONFIG, "apiToken" | "password">,
): string {
	return config.apiToken || config.password;
}

function runCliTransactionalSend(input: TransactionalCliInput): CliResult {
	const result = Bun.spawnSync(
		[
			"bun",
			CLI_ENTRY,
			"tx",
			"send",
			"--template-id",
			String(input.templateId),
			"--subscriber-email",
			input.recipient,
			"--from-email",
			"listmonk-ops@example.com",
			"--content-type",
			"html",
			"--data",
			JSON.stringify({ trace_id: input.traceId }),
			"--headers",
			JSON.stringify([{ [HEADER_NAME]: input.traceId }]),
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

function parseCliSentOutput(result: CliResult): { sent: true } {
	const diagnosticOutput = [result.stdout, result.stderr]
		.filter(Boolean)
		.join("\n");
	if (result.exitCode !== 0) {
		throw new Error(
			`CLI transactional send failed with exit ${result.exitCode}: ${diagnosticOutput}`,
		);
	}

	const lastLine = result.stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.at(-1);
	if (lastLine !== "true") {
		throw new Error(
			`CLI transactional send did not return true: ${diagnosticOutput}`,
		);
	}
	return { sent: true };
}

describe("Transactional CLI and MCP parity", () => {
	const { client, utils } = createMCPTestSuite();

	test("uses the legacy password when the E2E token is unavailable", () => {
		expect(
			resolveCliE2eCredential({
				apiToken: undefined,
				password: "legacy-password",
			}),
		).toBe("legacy-password");
	});

	test("parses successful CLI output without treating stderr as a result", () => {
		expect(
			parseCliSentOutput({
				exitCode: 0,
				stdout: "Transactional message sent\ntrue",
				stderr: "runtime warning",
			}),
		).toEqual({ sent: true });
	});

	test("sends equivalent contracts through the local Mailpit stack", async () => {
		const cliRecipient = buildTestEmail("transactional-cli");
		const mcpRecipient = buildTestEmail("transactional-mcp");
		const subject = buildTestName("transactional-parity-subject");
		const cliTraceId = buildTestName("transactional-cli-trace");
		const mcpTraceId = buildTestName("transactional-mcp-trace");
		const body = "Transactional delivery through CLI and MCP parity.";

		await utils.createTestSubscriber(
			cliRecipient,
			buildTestName("transactional-cli-subscriber"),
		);
		await utils.createTestSubscriber(
			mcpRecipient,
			buildTestName("transactional-mcp-subscriber"),
		);

		const createResult = await client.callTool("listmonk_create_template", {
			name: buildTestName("transactional-parity-template"),
			type: "tx",
			subject,
			body: `<p>${body}</p>`,
		});
		const template = utils.assertSuccess<{ id: number }>(
			createResult,
			"Failed to create transactional parity template",
		);

		const cliSent = parseCliSentOutput(
			runCliTransactionalSend({
				templateId: template.id,
				recipient: cliRecipient,
				traceId: cliTraceId,
			}),
		);

		const mcpResult = await client.callTool("listmonk_send_transactional", {
			template_id: template.id,
			subscriber_email: mcpRecipient,
			from_email: "listmonk-ops@example.com",
			content_type: "html",
			data: { trace_id: mcpTraceId },
			headers: [{ [HEADER_NAME]: mcpTraceId }],
		});
		expect(
			utils.assertSuccess<boolean>(
				mcpResult,
				"Failed to send transactional MCP parity message",
			),
		).toBe(true);
		expect(mcpResult.structuredContent).toEqual(cliSent);

		let cliDelivery: MailpitMessageSummary | undefined;
		let mcpDelivery: MailpitMessageSummary | undefined;
		await utils.waitFor(async () => {
			try {
				[cliDelivery, mcpDelivery] = await Promise.all([
					findMailpitMessage(cliRecipient, subject),
					findMailpitMessage(mcpRecipient, subject),
				]);
				return cliDelivery !== undefined && mcpDelivery !== undefined;
			} catch {
				return false;
			}
		}, 20000);

		if (!cliDelivery || !mcpDelivery) {
			throw new Error("Transactional parity messages were not found in Mailpit");
		}

		const deliveries = await Promise.all(
			[
				{ message: cliDelivery, recipient: cliRecipient, traceId: cliTraceId },
				{ message: mcpDelivery, recipient: mcpRecipient, traceId: mcpTraceId },
			].map(async ({ message, recipient, traceId }) => {
				const delivered = await fetchMailpitJson<MailpitMessage>(
					`/message/${message.ID}`,
				);
				const headers = await fetchMailpitJson<Record<string, string[]>>(
					`/message/${message.ID}/headers`,
				);
				return { delivered, headers, recipient, traceId };
			}),
		);

		for (const { delivered, headers, recipient, traceId } of deliveries) {
			expect(delivered.Subject).toBe(subject);
			expect(delivered.To?.map((address) => address.Address)).toContain(
				recipient,
			);
			expect(delivered.From.Address).toBe("listmonk-ops@example.com");
			expect(delivered.HTML).toContain(body);
			expect(headers[HEADER_NAME]).toContain(traceId);
		}
	});
});
