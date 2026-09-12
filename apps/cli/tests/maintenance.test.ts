import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import {
	renderGcAnalytics,
	renderGcSubscribers,
	renderGcUnconfirmed,
	type MaintenanceCliContext,
} from "../src/commands/maintenance";

function output() {
	return {
		info: mock(() => undefined),
		json: mock(() => undefined),
		success: mock(() => undefined),
		table: mock(() => undefined),
		warning: mock(() => undefined),
	};
}

describe("maintenance CLI actions", () => {
	test("renders the subscriber collection result", async () => {
		const gcSubscribers = mock(async () => ({ data: { count: 3 } }));
		const cliContext = {
			client: { maintenance: { gcSubscribers } } as unknown as Pick<
				ListmonkClient,
				"maintenance"
			>,
			output: output(),
		} satisfies MaintenanceCliContext;

		await renderGcSubscribers(cliContext, { type: "orphan" });
		expect(cliContext.output.success).toHaveBeenCalledWith(
			"Garbage-collected 3 orphan subscriber(s)",
		);
	});

	test("renders the unconfirmed collection result", async () => {
		const gcUnconfirmedSubscriptions = mock(async () => ({
			data: { count: 5 },
		}));
		const cliContext = {
			client: {
				maintenance: { gcUnconfirmedSubscriptions },
			} as unknown as Pick<ListmonkClient, "maintenance">,
			output: output(),
		} satisfies MaintenanceCliContext;

		await renderGcUnconfirmed(cliContext, {
			before_date: "2026-01-01T00:00:00Z",
		});
		expect(cliContext.output.success).toHaveBeenCalledWith(
			"Garbage-collected 5 unconfirmed subscription(s) before 2026-01-01T00:00:00Z",
		);
	});

	test("renders the analytics collection acknowledgement", async () => {
		const gcAnalytics = mock(async () => ({ data: true }));
		const cliContext = {
			client: {
				maintenance: { gcAnalytics },
			} as unknown as Pick<ListmonkClient, "maintenance">,
			output: output(),
		} satisfies MaintenanceCliContext;

		await renderGcAnalytics(cliContext, {
			type: "views",
			before_date: "2026-01-01T00:00:00Z",
		});
		expect(cliContext.output.success).toHaveBeenCalledWith(
			"Garbage-collected views analytics recorded before 2026-01-01T00:00:00Z",
		);
		expect(cliContext.output.json).toHaveBeenCalledWith({
			type: "views",
			before_date: "2026-01-01T00:00:00Z",
			deleted: true,
		});
	});
});
