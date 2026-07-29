import { afterEach, describe, expect, test } from "bun:test";
import {
	closeOutboundWebhookRuntimeRepositories,
	getOutboundWebhookStoreOptionsFromEnvironment,
	OUTBOUND_WEBHOOK_DATABASE_URL_ENV,
} from "../src/outbound-webhook-runtime";

const originalStorePath = process.env.LISTMONK_OPS_WEBHOOK_STORE;
const originalDatabaseUrl =
	process.env[OUTBOUND_WEBHOOK_DATABASE_URL_ENV];

afterEach(async () => {
	if (originalStorePath === undefined) {
		delete process.env.LISTMONK_OPS_WEBHOOK_STORE;
	} else {
		process.env.LISTMONK_OPS_WEBHOOK_STORE = originalStorePath;
	}
	if (originalDatabaseUrl === undefined) {
		delete process.env[OUTBOUND_WEBHOOK_DATABASE_URL_ENV];
	} else {
		process.env[OUTBOUND_WEBHOOK_DATABASE_URL_ENV] = originalDatabaseUrl;
	}
	await closeOutboundWebhookRuntimeRepositories();
});

describe("outbound webhook runtime selection", () => {
	test("uses the file repository by default", () => {
		delete process.env.LISTMONK_OPS_WEBHOOK_STORE;
		delete process.env[OUTBOUND_WEBHOOK_DATABASE_URL_ENV];

		expect(
			getOutboundWebhookStoreOptionsFromEnvironment().repository?.kind,
		).toBe("file");
	});

	test("rejects split-brain file and database configuration", () => {
		process.env.LISTMONK_OPS_WEBHOOK_STORE = "/tmp/webhooks.json";
		process.env[OUTBOUND_WEBHOOK_DATABASE_URL_ENV] =
			"postgres://listmonk:listmonk@127.0.0.1:15432/listmonk";

		expect(() => getOutboundWebhookStoreOptionsFromEnvironment()).toThrow(
			"Configure only one",
		);
	});

	test("caches Postgres repositories by connection and pool options", () => {
		delete process.env.LISTMONK_OPS_WEBHOOK_STORE;
		process.env[OUTBOUND_WEBHOOK_DATABASE_URL_ENV] =
			"postgres://listmonk:listmonk@127.0.0.1:15432/listmonk";

		const first = getOutboundWebhookStoreOptionsFromEnvironment();
		const second = getOutboundWebhookStoreOptionsFromEnvironment();
		const tuned = getOutboundWebhookStoreOptionsFromEnvironment({
			postgres: { maxConnections: 2 },
		});
		const tunedAgain = getOutboundWebhookStoreOptionsFromEnvironment({
			postgres: { maxConnections: 2 },
		});
		expect(first.repository?.kind).toBe("postgres");
		expect(second.repository).toBe(first.repository);
		expect(tuned.repository).not.toBe(first.repository);
		expect(tunedAgain.repository).toBe(tuned.repository);
	});
});
