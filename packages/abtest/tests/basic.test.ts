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
