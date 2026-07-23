import { describe, expect, test } from "bun:test";
import { buildCreateInputFromFlags } from "../src/commands/abtest";

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
});
