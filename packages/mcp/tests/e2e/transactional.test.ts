import { describe, expect, test } from "bun:test";
import {
	fetchMailpitJson,
	findMailpitMessage,
	type MailpitMessage,
	type MailpitMessageSummary,
} from "./mailpit.js";
import { createMCPTestSuite } from "../mcp-helper.js";
import { buildTestEmail, buildTestName } from "../setup.js";

describe("Transactional MCP Tool", () => {
	const { client, utils } = createMCPTestSuite();

	test("sends through the shared operation and delivers to Mailpit", async () => {
		const recipient = buildTestEmail("transactional");
		const subject = buildTestName("transactional-subject");
		const traceId = buildTestName("transactional-trace");
		const headerName = "X-Listmonk-Ops-Test";
		await utils.createTestSubscriber(
			recipient,
			buildTestName("transactional-subscriber"),
		);
		const createResult = await client.callTool("listmonk_create_template", {
			name: buildTestName("transactional-template"),
			type: "tx",
			subject,
			body: "<p>Transactional delivery through the shared operation.</p>",
		});
		const template = utils.assertSuccess<{ id: number }>(
			createResult,
			"Failed to create transactional template",
		);

		const sendResult = await client.callTool("listmonk_send_transactional", {
			template_id: template.id,
			subscriber_email: recipient,
			from_email: "listmonk-ops@example.com",
			content_type: "html",
			data: { trace_id: traceId },
			headers: [{ [headerName]: traceId }],
		});

		expect(
			utils.assertSuccess<boolean>(
				sendResult,
				"Failed to send transactional message",
			),
		).toBe(true);
		expect(sendResult.structuredContent).toEqual({ sent: true });

		let delivered: MailpitMessageSummary | undefined;
		await utils.waitFor(async () => {
			try {
				delivered = await findMailpitMessage(recipient, subject);
				return delivered !== undefined;
			} catch {
				return false;
			}
		}, 20000);

		if (!delivered) {
			throw new Error("Transactional message was not found in Mailpit");
		}
		const message = await fetchMailpitJson<MailpitMessage>(
			`/message/${delivered.ID}`,
		);
		expect(message.From.Address).toBe("listmonk-ops@example.com");
		expect(message.HTML).toContain(
			"Transactional delivery through the shared operation.",
		);

		const headers = await fetchMailpitJson<Record<string, string[]>>(
			`/message/${delivered.ID}/headers`,
		);
		expect(headers[headerName]).toContain(traceId);
	});
});
