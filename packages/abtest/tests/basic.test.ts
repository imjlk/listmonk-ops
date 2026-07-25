import { expect, test } from "bun:test";
import { AbTestService } from "../src/abtest-service";
import { CreateAbTestCommand } from "../src/basic";

test("CreateAbTestCommand uses provided campaign_id", async () => {
	const service = new AbTestService();
	const command = new CreateAbTestCommand(service);

	const created = await command.execute({
		name: "Campaign Id Regression",
		campaign_id: "campaign-123",
		lists: [1],
		variants: [
			{
				name: "A",
				percentage: 50,
				campaign_config: { subject: "A", body: "Body A" },
			},
			{
				name: "B",
				percentage: 50,
				campaign_config: { subject: "B", body: "Body B" },
			},
		],
	});

	expect(created.campaignId).toBe("campaign-123");
	expect(created.status).toBe("draft");
});

test("CreateAbTestCommand locks a provided hypothesis before provisioning", async () => {
	const service = new AbTestService();
	const command = new CreateAbTestCommand(service);

	const created = await command.execute({
		name: "Hypothesis Wiring",
		campaign_id: "campaign-456",
		lists: [1],
		variants: [
			{
				name: "A",
				percentage: 50,
				campaign_config: { subject: "A", body: "Body A" },
			},
			{
				name: "B",
				percentage: 50,
				campaign_config: { subject: "B", body: "Body B" },
			},
		],
		hypothesis: {
			objective: "Increase CTR",
			hypothesis: "Shorter subject lifts CTR",
			primary_metric: {
				type: "click_rate",
				direction: "maximize",
			},
			expected_lift: { kind: "relative", value: 0.1 },
			owner: { id: "user-1" },
			experiment_scope: {
				channel: "email",
				experiment_family_key: "onboarding.welcome",
				attribution_window_hours: 72,
				exclusion_window_hours: 168,
			},
		},
	});

	expect(created.hypothesis).toBeDefined();
	expect(created.hypothesis?.lockedAt).toBeDefined();
	expect(created.hypothesis?.checksum).toMatch(/^[0-9a-f]{64}$/);
	expect(created.assignmentProvenance).toBeUndefined();
});

test("analyzeStatisticalSignificance returns stable values on zero samples", async () => {
	const service = new AbTestService();

	const analysis = await service.analyzeStatisticalSignificance([
		{
			variantId: "a",
			sampleSize: 0,
			opens: 0,
			clicks: 0,
			conversions: 0,
			openRate: 0,
			clickRate: 0,
			conversionRate: 0,
		},
		{
			variantId: "b",
			sampleSize: 0,
			opens: 0,
			clicks: 0,
			conversions: 0,
			openRate: 0,
			clickRate: 0,
			conversionRate: 0,
		},
	]);

	expect(analysis.zScore).toBe(0);
	expect(analysis.pValue).toBe(1);
	expect(analysis.isSignificant).toBeFalse();
	expect(analysis.sampleSize).toBe(0);
});
