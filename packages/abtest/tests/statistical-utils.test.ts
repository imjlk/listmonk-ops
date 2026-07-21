import { expect, test } from "bun:test";
import { StatisticalUtils } from "../src/statistical-utils";

test("keeps zero-subscriber recommendations finite and JSON-safe", () => {
	const recommendation = StatisticalUtils.getSampleSizeRecommendation(0, 10, 2);

	expect(recommendation.recommendedTestPercentage).toBe(100);
	expect(recommendation.minimumTestPercentage).toBe(100);
	expect(Number.isFinite(recommendation.minimumTestPercentage)).toBe(true);
});
