import { describe, expect, spyOn, test } from "bun:test";
import { createPostgresOutboundWebhookClientOptions } from "../src/outbound-webhook-postgres";
import {
	createRuntimePostgresClientOptions,
	discardPostgresNotice,
} from "../src/postgres-client-options";
import { createPostgresSequenceClientOptions } from "../src/sequence-postgres";

describe("runtime Postgres client options", () => {
	test("disable named prepared statements and print no notices", () => {
		const options = createRuntimePostgresClientOptions({
			max: 2,
			idle_timeout: 30,
			connect_timeout: 5,
		});
		expect(options).toEqual({
			max: 2,
			idle_timeout: 30,
			connect_timeout: 5,
			prepare: false,
			onnotice: discardPostgresNotice,
		});

		const log = spyOn(console, "log").mockImplementation(() => undefined);
		const write = spyOn(process.stdout, "write").mockImplementation(
			() => true,
		);
		try {
			options.onnotice({
				severity: "NOTICE",
				code: "42P06",
				message: 'schema "listmonk_ops" already exists, skipping',
			});
			expect(log).not.toHaveBeenCalled();
			expect(write).not.toHaveBeenCalled();
		} finally {
			log.mockRestore();
			write.mockRestore();
		}
	});

	test("sequence runtime applies them with validated pool defaults", () => {
		expect(createPostgresSequenceClientOptions({})).toEqual({
			max: 5,
			idle_timeout: 20,
			connect_timeout: 10,
			prepare: false,
			onnotice: discardPostgresNotice,
		});
		expect(
			createPostgresSequenceClientOptions({
				maxConnections: 2,
				idleTimeoutSeconds: 60,
				connectTimeoutSeconds: 30,
			}),
		).toMatchObject({ max: 2, idle_timeout: 60, connect_timeout: 30 });
		expect(() =>
			createPostgresSequenceClientOptions({ maxConnections: 0 }),
		).toThrow("maxConnections must be between 1 and 50");
	});

	test("webhook runtime applies them with validated pool defaults", () => {
		expect(createPostgresOutboundWebhookClientOptions({})).toEqual({
			max: 5,
			idle_timeout: 20,
			connect_timeout: 10,
			prepare: false,
			onnotice: discardPostgresNotice,
		});
		expect(() =>
			createPostgresOutboundWebhookClientOptions({ maxConnections: 21 }),
		).toThrow("Webhook Postgres max connections must be between 1 and 20");
	});
});
