import { describe, expect, test } from "bun:test";
import {
	buildCreateInputFromFlags,
	buildRunAbTestInputFromFlags,
	formatOptOutSyncWarnings,
} from "../src/commands/abtest";

function createFlags(overrides: Partial<Parameters<typeof buildCreateInputFromFlags>[0]> = {}) {
	return {
		name: "Graph-visible test",
		"campaign-id": 42,
		variants: JSON.stringify([
			{ name: "Variant A" },
			{ name: "Variant B", percentage: 25 },
			{ name: "Variant C" },
		]),
		lists: "1,2",
		subject: "Base subject",
		body: "Base body",
		"testing-mode": "holdout" as const,
		"test-group-percentage": 20,
		"auto-deploy-winner": false,
		"ignore-sample-size-warnings": false,
		...overrides,
	};
}

describe("A/B test CLI input", () => {
	test("normalizes flag input before invoking the shared operation", () => {
		const input = buildCreateInputFromFlags(createFlags());

		expect(input).toMatchObject({
			name: "Graph-visible test",
			campaign_id: "42",
			lists: [1, 2],
			testing_mode: "holdout",
			test_group_percentage: 20,
			auto_deploy_winner: false,
			ignore_sample_size_warnings: false,
		});
		expect(input.variants).toEqual([
			{
				name: "Variant A",
				percentage: 37.5,
				campaign_config: { subject: "Base subject", body: "Base body" },
			},
			{
				name: "Variant B",
				percentage: 25,
				campaign_config: { subject: "Base subject", body: "Base body" },
			},
			{
				name: "Variant C",
				percentage: 37.5,
				campaign_config: { subject: "Base subject", body: "Base body" },
			},
		]);
	});

	test("rejects percentages that leave no room for missing variants", () => {
		expect(() =>
			buildCreateInputFromFlags(
				createFlags({
					variants: JSON.stringify([
						{ name: "Variant A", percentage: 60 },
						{ name: "Variant B", percentage: 40 },
						{ name: "Variant C" },
					]),
				}),
			),
		).toThrow("Variant percentages must sum to less than 100");
	});

	test("forwards inspected A/B state to the shared run operation", () => {
		expect(
			buildRunAbTestInputFromFlags({
				"test-id": "test-safe-run",
				"expected-status": "analyzing",
				"expected-updated-at": "2026-07-30T17:00:00.000Z",
			}),
		).toEqual({
			test_id: "test-safe-run",
			expected_status: "analyzing",
			expected_updated_at: "2026-07-30T17:00:00.000Z",
		});
	});

	test("names every temporary list whose opt-outs could not be carried", () => {
		expect(
			formatOptOutSyncWarnings({
				dry_run: false,
				checked: 3,
				failed: 2,
				results: [
					{
						test_id: "test-ok",
						status: "completed",
						deleted: false,
						source_list_ids: [1],
						lists: [
							{ list_id: 200, status: "propagated", opted_out: 1, carried: 1, pending: 0 },
						],
					},
					{
						test_id: "test-partial",
						status: "cancelled",
						deleted: true,
						source_list_ids: [1, 2],
						lists: [
							{ list_id: 201, status: "up_to_date", opted_out: 2, carried: 0, pending: 0 },
							{
								list_id: 202,
								status: "failed",
								opted_out: 3,
								carried: 1,
								pending: 2,
								detail: "2 opted-out subscriber(s) are still subscribed",
							},
							{ list_id: 203, status: "blocked", opted_out: 1, carried: 0, pending: 1 },
						],
					},
					{
						test_id: "test-broken",
						status: "completed",
						deleted: false,
						source_list_ids: [],
						lists: [],
						detail: "unexpected record",
					},
				],
			}),
		).toEqual([
			"A/B test test-partial temporary list 202 failed: 2 opted-out subscriber(s) are still subscribed",
			"A/B test test-partial temporary list 203 blocked: its opt-outs were not confirmed on the source lists",
			"A/B test test-broken opt-out sync failed: unexpected record",
		]);
	});
});
