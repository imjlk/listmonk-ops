import type { ListmonkClient } from "@listmonk-ops/openapi";

type SubscriberClient = Pick<ListmonkClient, "subscriber">;

function subscriberContext(
	exportFn: SubscriberClient["subscriber"]["export"],
): { client: SubscriberClient } {
	return { client: { subscriber: { export: exportFn } } as SubscriberClient };
}
import { describe, expect, mock, test } from "bun:test";
import {
	invokeExportSubscriberOperation,
	invokeSendOptinOperation,
	invokeGetSubscriberImportLogsOperation,
	invokeGetSubscriberImportStatusOperation,
	invokeStartSubscriberImportOperation,
	invokeStopSubscriberImportOperation,
	subscriberOperations,
} from "../src/subscribers";
import { OperationExecutionError } from "../src/operation";

type ImportClient = Pick<ListmonkClient, "import">;

function importContext(
	methods: Partial<ImportClient["import"]>,
): { client: ImportClient } {
	return { client: { import: methods } as ImportClient };
}

describe("subscriber import operations", () => {
	test("registers the import lifecycle with per-operation safety", () => {
		const ids = subscriberOperations.map((operation) => operation.id);
		expect(ids).toContain("subscribers.import.start");
		expect(ids).toContain("subscribers.import.status");
		expect(ids).toContain("subscribers.import.stop");
		const start = subscriberOperations.find(
			(operation) => operation.id === "subscribers.import.start",
		);
		expect(start?.safety).toMatchObject({
			readOnlyHint: false,
			destructiveHint: true,
			idempotentHint: false,
		});
		const status = subscriberOperations.find(
			(operation) => operation.id === "subscribers.import.status",
		);
		expect(status?.safety.readOnlyHint).toBe(true);
	});

	test("starts an import through the multipart wrapper", async () => {
		const start = mock(async () => ({
			data: { name: "import.csv", total: 0, imported: 0, status: "importing" },
		}));

		await expect(
			invokeStartSubscriberImportOperation(
				importContext({
					start: start as unknown as ImportClient["import"]["start"],
				}),
				{
					mode: "subscribe",
					delim: ",",
					lists: [1, 2],
					overwrite: false,
					subscription_status: "confirmed",
					csv: "email,name\na@example.com,A\n",
				},
			),
		).resolves.toEqual({
			name: "import.csv",
			total: 0,
			imported: 0,
			status: "importing",
		});

		const params = (start.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
		expect(params.mode).toBe("subscribe");
		expect(params.lists).toEqual([1, 2]);
		expect(params.subscription_status).toBe("confirmed");
		expect(params.file).toBeInstanceOf(File);
	});

	test("reads and stops the import session", async () => {
		const get = mock(async () => ({
			data: { name: "import.csv", total: 3, imported: 3, status: "finished" },
		}));
		const stop = mock(async () => ({
			data: { name: "", total: 0, imported: 0, status: "none" },
		}));
		const context = importContext({
			get: get as ImportClient["import"]["get"],
			stop: stop as ImportClient["import"]["stop"],
		});

		await expect(
			invokeGetSubscriberImportStatusOperation(context, {}),
		).resolves.toMatchObject({ status: "finished", imported: 3 });
		await expect(invokeStopSubscriberImportOperation(context, {})).resolves.toMatchObject(
			{ status: "none" },
		);
	});

	test("rejects malformed import inputs before requests", async () => {
		const start = mock(async () => ({ data: {} }));
		await expect(
			invokeStartSubscriberImportOperation(
				importContext({
					start: start as unknown as ImportClient["import"]["start"],
				}),
				{
					mode: "subscribe",
					delim: ",,",
					lists: [1],
					overwrite: false,
					csv: "email\n",
				},
			),
		).rejects.toThrow();
		expect(start).not.toHaveBeenCalled();
	});

	test("surfaces transport failures through the operation error contract", async () => {
		const get = mock(async () => ({
			error: "invalid API credentials",
			response: { status: 403 },
		}));
		const error = await invokeGetSubscriberImportStatusOperation(
			importContext({
				get: get as unknown as ImportClient["import"]["get"],
			}),
			{},
		).catch((failure: unknown) => failure);
		expect(error).toBeInstanceOf(OperationExecutionError);
		expect(error).toHaveProperty("operationId", "subscribers.import.status");
	});
});

describe("subscriber import logs", () => {
	test("reads raw log lines through the shared operation", async () => {
		const logs = mock(async () => ({
			data: "2026/09/05 importer.go:193: processing 'import.csv'\n",
		}));

		await expect(
			invokeGetSubscriberImportLogsOperation(
				importContext({
					logs: logs as unknown as ImportClient["import"]["logs"],
				}),
				{},
			),
		).resolves.toEqual({
			logs: "2026/09/05 importer.go:193: processing 'import.csv'\n",
		});
		expect(logs).toHaveBeenCalledTimes(1);
	});

	test("rejects a response without data through the error contract", async () => {
		const logs = mock(async () => ({ data: undefined }));
		await expect(
			invokeGetSubscriberImportLogsOperation(
				importContext({
					logs: logs as unknown as ImportClient["import"]["logs"],
				}),
				{},
			),
		).rejects.toThrow("Failed to read subscriber import logs");
	});
});

describe("subscriber export", () => {
	test("reads the data-portability bundle through the shared operation", async () => {
		const exportFn = mock(async () => ({
			data: {
				profile: [{ id: 663, email: "reader@example.com" }],
				subscriptions: [{ name: "Private list" }],
				campaign_views: [],
				link_clicks: [],
			},
		}));

		await expect(
			invokeExportSubscriberOperation(
				subscriberContext(
					exportFn as unknown as SubscriberClient["subscriber"]["export"],
				),
				{ id: "663" },
			),
		).resolves.toEqual({
			profile: [{ id: 663, email: "reader@example.com" }],
			subscriptions: [{ name: "Private list" }],
			campaign_views: [],
			link_clicks: [],
		});
		expect(exportFn).toHaveBeenCalledWith({ path: { id: 663 } });
	});

	test("surfaces transport failures through the operation error contract", async () => {
		const exportFn = mock(async () => ({
			error: "not found",
			response: { status: 500 },
		}));
		const error = await invokeExportSubscriberOperation(
			subscriberContext(
				exportFn as unknown as SubscriberClient["subscriber"]["export"],
			),
			{ id: 1 },
		).catch((failure: unknown) => failure);
		expect(error).toBeInstanceOf(OperationExecutionError);
		expect(error).toHaveProperty("operationId", "subscribers.export");
	});
});

describe("subscriber opt-in resend", () => {
	test("sends the opt-in email through the shared operation", async () => {
		const sendOptin = mock(async () => ({ data: true }));

		await expect(
			invokeSendOptinOperation(
				{ client: { subscriber: { sendOptin } } as unknown as SubscriberClient },
				{ id: "663" },
			),
		).resolves.toEqual({ id: 663, sent: true });
		expect(sendOptin).toHaveBeenCalledWith({ path: { id: 663 } });
	});

	test("rejects a negative acknowledgement", async () => {
		const sendOptin = mock(async () => ({ data: false }));
		await expect(
			invokeSendOptinOperation(
				{ client: { subscriber: { sendOptin } } as unknown as SubscriberClient },
				{ id: 663 },
			),
		).rejects.toThrow("negative acknowledgement");
	});
});
