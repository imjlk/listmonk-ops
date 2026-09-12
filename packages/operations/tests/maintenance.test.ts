import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import {
	invokeGcAnalyticsOperation,
	invokeGcSubscribersOperation,
	invokeGcUnconfirmedOperation,
	invokeMaintenanceOperationByMcpName,
	maintenanceOperations,
} from "../src/maintenance";
import { OperationExecutionError } from "../src/operation";

type MaintenanceClient = Pick<ListmonkClient, "maintenance">;

function maintenanceContext(
	methods: Partial<MaintenanceClient["maintenance"]>,
): { client: MaintenanceClient } {
	return { client: { maintenance: methods } as MaintenanceClient };
}

describe("maintenance operations", () => {
	test("registers destructive one-shot collections with confirmation gating", () => {
		expect(maintenanceOperations).toHaveLength(3);
		for (const operation of maintenanceOperations) {
			expect(operation.safety.destructiveHint).toBe(true);
			expect(operation.safety.readOnlyHint).toBe(false);
		}
	});

	test("collects a subscriber set and reports the deleted count", async () => {
		const gcSubscribers = mock(async () => ({ data: { count: 8 } }));

		await expect(
			invokeGcSubscribersOperation(
				maintenanceContext({
					gcSubscribers:
						gcSubscribers as unknown as MaintenanceClient["maintenance"]["gcSubscribers"],
				}),
				{ type: "orphan" },
			),
		).resolves.toEqual({ type: "orphan", count: 8 });
		expect(gcSubscribers).toHaveBeenCalledWith({ path: { type: "orphan" } });
	});

	test("collects unconfirmed subscriptions through the query-parameter cutoff", async () => {
		const gcUnconfirmedSubscriptions = mock(async () => ({
			data: { count: 7 },
		}));

		await expect(
			invokeGcUnconfirmedOperation(
				maintenanceContext({
					gcUnconfirmedSubscriptions:
						gcUnconfirmedSubscriptions as unknown as MaintenanceClient["maintenance"]["gcUnconfirmedSubscriptions"],
				}),
				{ before_date: "2026-01-01T00:00:00Z" },
			),
		).resolves.toEqual({
			before_date: "2026-01-01T00:00:00Z",
			count: 7,
		});
		expect(gcUnconfirmedSubscriptions).toHaveBeenCalledWith({
			query: { before_date: "2026-01-01T00:00:00Z" },
		});
	});

	test("rejects a non-RFC3339 cutoff before any request", async () => {
		const gcUnconfirmedSubscriptions = mock(async () => ({ data: {} }));
		await expect(
			invokeGcUnconfirmedOperation(
				maintenanceContext({
					gcUnconfirmedSubscriptions:
						gcUnconfirmedSubscriptions as unknown as MaintenanceClient["maintenance"]["gcUnconfirmedSubscriptions"],
				}),
				{ before_date: "2026-01-01" },
			),
		).rejects.toThrow();
		expect(gcUnconfirmedSubscriptions).not.toHaveBeenCalled();
	});

	test("surfaces transport failures through the operation error contract", async () => {
		const gcSubscribers = mock(async () => ({
			error: "invalid API credentials",
			response: { status: 403 },
		}));
		const error = await invokeGcSubscribersOperation(
			maintenanceContext({
				gcSubscribers:
					gcSubscribers as unknown as MaintenanceClient["maintenance"]["gcSubscribers"],
			}),
			{ type: "orphan" },
		).catch((failure: unknown) => failure);
		expect(error).toBeInstanceOf(OperationExecutionError);
		expect(error).toHaveProperty(
			"operationId",
			"maintenance.gc-subscribers",
		);
	});

	test("collects analytics through the query-parameter cutoff", async () => {
		const gcAnalytics = mock(async () => ({ data: true }));

		await expect(
			invokeGcAnalyticsOperation(
				maintenanceContext({
					gcAnalytics:
						gcAnalytics as unknown as MaintenanceClient["maintenance"]["gcAnalytics"],
				}),
				{ type: "views", before_date: "2020-01-01T00:00:00Z" },
			),
		).resolves.toEqual({
			type: "views",
			before_date: "2020-01-01T00:00:00Z",
			deleted: true,
		});
		expect(gcAnalytics).toHaveBeenCalledWith({
			path: { type: "views" },
			query: { before_date: "2020-01-01T00:00:00Z" },
		});
	});

	test("rejects an analytics run with an unsupported type or cutoff before any request", async () => {
		const gcAnalytics = mock(async () => ({ data: true }));
		const context = maintenanceContext({
			gcAnalytics:
				gcAnalytics as unknown as MaintenanceClient["maintenance"]["gcAnalytics"],
		});
		await expect(
			invokeGcAnalyticsOperation(context, { type: "bounces", before_date: "2020-01-01T00:00:00Z" }),
		).rejects.toThrow();
		await expect(
			invokeGcAnalyticsOperation(context, { type: "views", before_date: "2020-01-01" }),
		).rejects.toThrow();
		expect(gcAnalytics).not.toHaveBeenCalled();
	});

	test("dispatches MCP names through the named operations", async () => {
		const gcSubscribers = mock(async () => ({ data: { count: 0 } }));
		const context = maintenanceContext({
			gcSubscribers:
				gcSubscribers as unknown as MaintenanceClient["maintenance"]["gcSubscribers"],
		});
		await expect(
			invokeMaintenanceOperationByMcpName(
				context,
				"listmonk_gc_subscribers",
				{ type: "blocklisted" },
			),
		).resolves.toMatchObject({
			operation: maintenanceOperations[0],
			output: { type: "blocklisted", count: 0 },
		});
		await expect(
			invokeMaintenanceOperationByMcpName(context, "listmonk_unknown", {}),
		).resolves.toBe(undefined);
	});
});
