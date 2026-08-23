import { describe, expect, test } from "bun:test";
import {
	createClient,
	getSubscribers,
	transactWithSubscriber,
} from "@listmonk-ops/openapi/sdk";
import {
	fetchMailpitJson,
	findMailpitMessage,
	findMailpitMessages,
	type MailpitMessage,
	type MailpitMessageSummary,
} from "./mailpit.js";
import { createMCPTestSuite } from "../mcp-helper.js";
import { buildTestEmail, buildTestName, TEST_CONFIG } from "../setup.js";

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
		const template = utils.assertSuccess<{ template?: { id?: number } }>(
			createResult,
			"Failed to create transactional template",
		).template as { id: number };
		expect(template?.id).toBeDefined();

		const sendResult = await client.callTool("listmonk_send_transactional", {
			template_id: template.id,
			subscriber_email: recipient,
			from_email: "listmonk-ops@example.com",
			content_type: "html",
			data: { trace_id: traceId },
			headers: [{ [headerName]: traceId }],
		});

		// assertSuccess returns the legacySuccessText result (boolean); read
		// the structured object from result.structuredContent instead.
		expect(sendResult.isError).toBeFalsy();
		const sendStructured = sendResult.structuredContent as {
			sent: boolean;
			status: string;
		};
		expect(sendStructured.sent).toBe(true);
		expect(sendStructured.status).toBe("accepted");

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

	test("sends to an external address through the public SDK without creating a subscriber", async () => {
		const recipient = buildTestEmail("transactional-external");
		const subject = buildTestName("transactional-external-subject");
		const createResult = await client.callTool("listmonk_create_template", {
			name: buildTestName("transactional-external-template"),
			type: "tx",
			subject,
			body: "<p>External transactional delivery through the generated SDK.</p>",
		});
		const template = utils.assertSuccess<{ template?: { id?: number } }>(
			createResult,
			"Failed to create external transactional template",
		).template as { id: number };
		expect(template?.id).toBeDefined();
		try {
			if (!TEST_CONFIG.apiToken) {
				throw new Error("External SDK smoke requires a Listmonk API token");
			}
			const sdkClient = createClient({
				baseUrl: TEST_CONFIG.baseUrl,
				headers: {
					Authorization: `token ${TEST_CONFIG.username}:${TEST_CONFIG.apiToken}`,
				},
			});

			const sendResult = await transactWithSubscriber({
				client: sdkClient,
				body: {
					subscriber_mode: "external",
					subscriber_emails: [recipient],
					template_id: template.id,
					from_email: "listmonk-ops@example.com",
					data: { delivery_mode: "external" },
				},
			});
			if (sendResult.error !== undefined) {
				throw new Error(
					`External SDK send failed: ${JSON.stringify(sendResult.error)}`,
				);
			}
			expect(sendResult.data?.data).toBe(true);

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
				throw new Error("External transactional message was not found in Mailpit");
			}

			const subscribers = await getSubscribers({
				client: sdkClient,
				query: { query: `email = '${recipient}'`, per_page: "all" },
			});
			if (subscribers.error !== undefined) {
				throw new Error(
					`External subscriber verification failed: ${JSON.stringify(subscribers.error)}`,
				);
			}
			expect(subscribers.data?.data?.results ?? []).toHaveLength(0);
		} finally {
			const deleteResult = await client.callTool("listmonk_delete_template", {
				id: template.id,
				confirm: true,
			});
			utils.assertSuccess(
				deleteResult,
				"Failed to delete external transactional template",
			);
		}
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
		const template = utils.assertSuccess<{ template?: { id?: number } }>(
			createResult,
			"Failed to create transactional idempotency template",
		).template as { id: number };
		expect(template?.id).toBeDefined();

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
		expect(first.isError).toBeFalsy();
		const firstStructured = first.structuredContent as {
			sent: boolean;
			status: string;
			duplicate?: boolean;
			idempotency_key?: string;
		};
		expect(firstStructured.sent).toBe(true);
		expect(firstStructured.status).toBe("accepted");
		expect(firstStructured.duplicate).toBe(false);
		expect(firstStructured.idempotency_key).toBe(idempotencyKey);

		// Identical retry — Listmonk must not be called again.
		const replay = await client.callTool("listmonk_send_transactional", payload);
		expect(replay.isError).toBeFalsy();
		const replayStructured = replay.structuredContent as {
			sent: boolean;
			status: string;
			duplicate?: boolean;
			idempotency_key?: string;
		};
		expect(replayStructured.sent).toBe(true);
		expect(replayStructured.status).toBe("replayed");
		expect(replayStructured.duplicate).toBe(true);
		expect(replayStructured.idempotency_key).toBe(idempotencyKey);

		// Exactly one delivery landed in Mailpit. Query the full match list
		// (not just the first match) so an accidental second dispatch would
		// surface as a count > 1.
		let deliveries: MailpitMessageSummary[] = [];
		await utils.waitFor(async () => {
			try {
				deliveries = await findMailpitMessages(recipient, subject);
				return deliveries.length >= 1;
			} catch {
				return false;
			}
		}, 20000);
		// Give a duplicate a brief window to surface if the wrapper regressed
		// and re-dispatched; the count must remain 1.
		await new Promise((resolve) => setTimeout(resolve, 1500));
		deliveries = await findMailpitMessages(recipient, subject);
		expect(deliveries).toHaveLength(1);
	});
});
