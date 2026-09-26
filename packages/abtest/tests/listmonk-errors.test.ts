import { describe, expect, it } from "bun:test";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import { errorEnvelopeMessage } from "../src/lifecycle";
import {
	formatListmonkError,
	formatListmonkErrorResponse,
	listmonkResponseStatus,
} from "../src/listmonk-errors";
import { ListmonkAbTestIntegration } from "../src/listmonk-integration";
import { ListmonkMetricsCollector } from "../src/metrics";
import type { AbTest } from "../src/types";

// The generated client's error envelope: the parsed Listmonk body plus the
// HTTP response.
function envelope(error: unknown, status?: number) {
	return status === undefined ? { error } : { error, response: { status } };
}

describe("formatListmonkError", () => {
	it("renders Listmonk error bodies instead of [object Object]", () => {
		expect(formatListmonkError({ message: "Campaign not found." })).toBe(
			"Campaign not found.",
		);
		expect(formatListmonkError({ error: "permission denied" })).toBe(
			"permission denied",
		);
		expect(formatListmonkError({ code: 42 })).toBe('{"code":42}');
	});

	it("renders strings, errors, and unserializable values", () => {
		expect(formatListmonkError("plain text")).toBe("plain text");
		expect(formatListmonkError(new Error("fetch failed"))).toBe("fetch failed");
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		expect(formatListmonkError(circular)).toBe("[object Object]");
		expect(formatListmonkError(undefined)).toBe("undefined");
	});

	it("truncates oversized bodies such as proxy error pages", () => {
		const page = `<html>${"x".repeat(2000)}</html>`;
		const rendered = formatListmonkError(page);
		expect(rendered).toHaveLength(500 + "... (truncated)".length);
		expect(rendered.endsWith("... (truncated)")).toBe(true);
	});
});

describe("formatListmonkErrorResponse", () => {
	it("prefixes the HTTP status when the envelope carries a response", () => {
		expect(
			formatListmonkErrorResponse(
				envelope({ message: "Campaign not found." }, 404),
			),
		).toBe("HTTP 404: Campaign not found.");
		expect(formatListmonkErrorResponse(envelope("", 502))).toBe("HTTP 502");
		expect(formatListmonkErrorResponse(envelope("boom"))).toBe("boom");
		expect(listmonkResponseStatus(envelope("boom"))).toBeUndefined();
		expect(listmonkResponseStatus(envelope("boom", 500))).toBe(500);
	});

	it("renders an absent body as empty instead of undefined", () => {
		expect(formatListmonkErrorResponse(envelope(undefined, 500))).toBe(
			"HTTP 500",
		);
		expect(formatListmonkErrorResponse(envelope(undefined))).toBe("");
	});

	it("never renders the request or its credentials", () => {
		const request = new Request("http://listmonk.test/api/campaigns/8", {
			headers: { Authorization: "token api-user:very-secret-token" },
		});
		const rendered = formatListmonkErrorResponse({
			error: { message: "Invalid session." },
			request,
			response: new Response(null, { status: 403 }),
		});
		expect(rendered).toBe("HTTP 403: Invalid session.");
		expect(rendered).not.toContain("very-secret-token");
	});
});

describe("Listmonk error rendering at call sites", () => {
	it("reports the failing campaign update with the Listmonk message", async () => {
		const client = {
			campaign: {
				update: async () => envelope({ message: "Campaign not found." }, 404),
			},
		} as unknown as ListmonkClient;
		const integration = new ListmonkAbTestIntegration(client);

		await expect(
			integration.launchTest(
				[{ variantId: "A", campaignId: 8 }],
				[{ variantId: "A", listId: 9 }],
			),
		).rejects.toThrow(
			"Failed to update campaign 8: HTTP 404: Campaign not found.",
		);
	});

	it("reports a failing status transition with the Listmonk message", async () => {
		const client = {
			campaign: {
				update: async () => ({ data: true }),
				updateStatus: async () =>
					envelope({ message: "send_at date should be in the future" }, 400),
			},
		} as unknown as ListmonkClient;
		const integration = new ListmonkAbTestIntegration(client);

		await expect(
			integration.launchTest(
				[{ variantId: "A", campaignId: 8 }],
				[{ variantId: "A", listId: 9 }],
				{ sendAt: "2026-01-01T00:00:00Z" },
			),
		).rejects.toThrow(
			"Failed to update status for campaign 8: HTTP 400: send_at date should be in the future",
		);
	});

	it("appends only the detail an envelope actually carries", async () => {
		const responses = new Map<number, unknown>([
			[8, envelope(undefined, 500)],
			[9, envelope(undefined)],
		]);
		const client = {
			campaign: {
				getById: async ({ path }: { path: { id: number } }) =>
					responses.get(path.id),
			},
		} as unknown as ListmonkClient;
		const collector = new ListmonkMetricsCollector(client);
		const collect = (campaignId: number) =>
			collector.collect({
				id: "test-1",
				campaignMappings: [{ variantId: "A", campaignId }],
			} as AbTest);

		await expect(collect(8)).rejects.toThrow(
			"Metrics unavailable for A/B test test-1: campaign 8 returned no data: HTTP 500",
		);
		const bare = await collect(9).then(
			() => undefined,
			(error: unknown) => error,
		);
		expect((bare as Error).message).toBe(
			"Metrics unavailable for A/B test test-1: campaign 9 returned no data",
		);
	});

	it("describes cancel-plan envelopes with status and message", () => {
		expect(
			errorEnvelopeMessage(
				envelope({ message: "Only active campaigns can be cancelled" }, 400),
			),
		).toBe("HTTP 400: Only active campaigns can be cancelled");
	});

	it("names the metrics failure cause", async () => {
		const client = {
			campaign: {
				getById: async () => envelope({ message: "Campaign not found." }, 404),
			},
		} as unknown as ListmonkClient;
		const collector = new ListmonkMetricsCollector(client);

		await expect(
			collector.collect({
				id: "test-1",
				campaignMappings: [{ variantId: "A", campaignId: 8 }],
			} as AbTest),
		).rejects.toThrow(
			"Metrics unavailable for A/B test test-1: campaign 8 returned no data: HTTP 404: Campaign not found.",
		);
	});

	it("keeps a non-404 cleanup failure a failure even when its body says not found", async () => {
		const deletedCampaigns: number[] = [];
		const client = {
			campaign: {
				getById: async () =>
					envelope({ message: "template not found for campaign" }, 500),
				delete: async ({ path }: { path: { id: number } }) => {
					deletedCampaigns.push(path.id);
					return { data: true };
				},
			},
			list: { delete: async () => ({ data: true }) },
		} as unknown as ListmonkClient;
		const integration = new ListmonkAbTestIntegration(client);

		await expect(
			integration.deleteTestResources({ campaignIds: [7], listIds: [11] }),
		).rejects.toThrow(
			"Failed to fetch campaign 7: HTTP 500: template not found for campaign",
		);
		expect(deletedCampaigns).toEqual([]);
	});
});
