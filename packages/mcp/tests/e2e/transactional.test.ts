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

		const sendStructured = utils.assertSuccess<{
			sent: boolean;
			status: string;
		}>(sendResult, "Failed to send transactional message");
		expect(sendStructured.sent).toBe(true);
		expect(sendStructured.status).toBe("accepted");
		expect(sendResult.structuredContent).toMatchObject({
			sent: true,
			status: "accepted",
		});

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

	test("replays an idempotent send instead of re-dispatching", async () => {
		const recipient = buildTestEmail("transactional-idem");
		const subject = buildTestName("transactional-idem-subject");
		const traceId = buildTestName("transactional-idem-trace");
		const idempotencyKey = buildTestName("transactional-idem-key");
		const headerName = "X-Listmonk-Ops-Idem-Test";
		const body = "<p>Transactional idempotency replay.</p>";

		await utils.createTestSubscriber(
			recipient,
			buildTestName("transactional-idem-subscriber"),
		);
		const createResult = await client.callTool("listmonk_create_template", {
			name: buildTestName("transactional-idem-template"),
			type: "tx",
			subject,
			body,
		});
		const template = utils.assertSuccess<{ id: number }>(
			createResult,
			"Failed to create transactional idempotency template",
		);

		const payload = {
			template_id: template.id,
			subscriber_email: recipient,
			from_email: "listmonk-ops@example.com",
			content_type: "html" as const,
			data: { trace_id: traceId },
			headers: [{ [headerName]: traceId }],
			idempotency_key: idempotencyKey,
		};

		const first = await client.callTool("listmonk_send_transactional", payload);
		const firstStructured = utils.assertSuccess<{
			sent: boolean;
			status: string;
			duplicate?: boolean;
			idempotency_key?: string;
		}>(first, "Failed to send first transactional idempotency message");
		expect(firstStructured.sent).toBe(true);
		expect(firstStructured.status).toBe("accepted");
		expect(firstStructured.duplicate).toBe(false);
		expect(firstStructured.idempotency_key).toBe(idempotencyKey);

		// Identical retry — Listmonk must not be called again.
		const replay = await client.callTool("listmonk_send_transactional", payload);
		const replayStructured = utils.assertSuccess<{
			sent: boolean;
			status: string;
			duplicate?: boolean;
			idempotency_key?: string;
		}>(replay, "Failed to replay transactional idempotency message");
		expect(replayStructured.sent).toBe(true);
		expect(replayStructured.status).toBe("replayed");
		expect(replayStructured.duplicate).toBe(true);
		expect(replayStructured.idempotency_key).toBe(idempotencyKey);

		// Exactly one delivery landed in Mailpit.
		let delivered: MailpitMessageSummary | undefined;
		let duplicateDelivery: MailpitMessageSummary | undefined;
		await utils.waitFor(async () => {
			try {
				delivered = await findMailpitMessage(recipient, subject);
				return delivered !== undefined;
			} catch {
				return false;
			}
		}, 20000);
		// Give the duplicate a brief window to surface if the wrapper regressed
		// and re-dispatched; it should remain absent.
		await new Promise((resolve) => setTimeout(resolve, 1500));
		try {
			const messages = await findMailpitMessage(recipient, subject);
			duplicateDelivery = messages;
		} catch {
			duplicateDelivery = undefined;
		}
		if (!delivered) {
			throw new Error("Idempotent transactional message was not delivered");
		}
		expect(duplicateDelivery?.ID ?? delivered.ID).toBe(delivered.ID);
	});
});
