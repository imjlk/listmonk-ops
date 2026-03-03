import type { SampleSizeRecommendation, TestValidationResult } from "./types";

function erf(x: number): number {
	const a1 = 0.254829592;
	const a2 = -0.284496736;
	const a3 = 1.421413741;
	const a4 = -1.453152027;
	const a5 = 1.061405429;
	const p = 0.3275911;

	const sign = x >= 0 ? 1 : -1;
	const absX = Math.abs(x);

	const t = 1 / (1 + p * absX);
	const y =
		1 -
		((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-(absX ** 2));

	return sign * y;
}

function standardNormalCDF(z: number): number {
	return 0.5 * (1 + erf(z / Math.sqrt(2)));
}

function calculateMinimumSampleSize(
	baselineConversionRate: number = 0.05,
	minimumDetectableEffect: number = 0.2,
	_alpha: number = 0.05,
	_beta: number = 0.2,
): number {
	// Fixed z-scores for 95% confidence / 80% power.
	const zAlpha = 1.96;
	const zBeta = 0.84;

	const p1 = baselineConversionRate;
	const p2 = baselineConversionRate * (1 + minimumDetectableEffect);
	const pPooled = (p1 + p2) / 2;

	const numerator =
		(zAlpha * Math.sqrt(2 * pPooled * (1 - pPooled)) +
			zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) **
		2;
	const denominator = (p2 - p1) ** 2;

	return Math.ceil(numerator / denominator);
}

function calculateStatisticalPower(
	sampleSize: number,
	baselineConversionRate: number,
	minimumDetectableEffect: number,
	_alpha: number = 0.05,
): number {
	if (sampleSize < 10) return 0;

	const p1 = baselineConversionRate;
	const p2 = baselineConversionRate * (1 + minimumDetectableEffect);
	const pPooled = (p1 + p2) / 2;
	const standardError = Math.sqrt((2 * pPooled * (1 - pPooled)) / sampleSize);
	const zAlpha = 1.96;
	const effectSize = Math.abs(p2 - p1);
	const zBeta =
		(effectSize - zAlpha * standardError) /
		Math.sqrt((p1 * (1 - p1) + p2 * (1 - p2)) / sampleSize);
	const power = standardNormalCDF(zBeta);

	return Math.max(0, Math.min(1, power));
}

function getSampleSizeRecommendation(
	totalSubscribers: number,
	requestedTestPercentage: number,
	variantCount: number = 2,
	baselineConversionRate: number = 0.05,
	minimumDetectableEffect: number = 0.2,
): SampleSizeRecommendation {
	const minimumSamplePerVariant = calculateMinimumSampleSize(
		baselineConversionRate,
		minimumDetectableEffect,
	);

	const currentTestPercentage = Math.max(
		1,
		Math.min(100, requestedTestPercentage),
	);
	const currentTestGroupSize = Math.floor(
		(totalSubscribers * currentTestPercentage) / 100,
	);
	const expectedSamplePerVariant = Math.floor(
		currentTestGroupSize / variantCount,
	);

	const totalMinimumSampleNeeded = minimumSamplePerVariant * variantCount;
	const recommendedTestPercentage = Math.min(
		100,
		Math.ceil((totalMinimumSampleNeeded / totalSubscribers) * 100),
	);
	const minimumTestPercentage = Math.max(
		1,
		Math.ceil((totalMinimumSampleNeeded / totalSubscribers) * 100),
	);
	const statisticalPower = calculateStatisticalPower(
		expectedSamplePerVariant,
		baselineConversionRate,
		minimumDetectableEffect,
	);

	const warnings: string[] = [];
	const recommendations: string[] = [];

	if (currentTestPercentage < 1) {
		warnings.push("Test group percentage cannot be less than 1%");
	}

	if (expectedSamplePerVariant < minimumSamplePerVariant) {
		warnings.push(
			`Current configuration provides ${expectedSamplePerVariant} samples per variant, ` +
				`but ${minimumSamplePerVariant} is recommended for statistical significance`,
		);
	}

	if (statisticalPower < 0.8) {
		warnings.push(
			`Statistical power is ${(statisticalPower * 100).toFixed(1)}% ` +
				`(recommended: 80%+)`,
		);
	}

	if (currentTestPercentage < recommendedTestPercentage) {
		recommendations.push(
			`Consider increasing test group to ${recommendedTestPercentage}% ` +
				"for optimal statistical power",
		);
	}

	if (totalSubscribers < 1000) {
		recommendations.push(
			"Small subscriber list may not provide reliable A/B test results. " +
				"Consider collecting more subscribers or using full-split mode.",
		);
	}

	if (expectedSamplePerVariant < 100) {
		recommendations.push(
			"Very small sample size per variant. Results may not be statistically reliable.",
		);
	}

	return {
		totalSubscribers,
		recommendedTestPercentage,
		minimumTestPercentage,
		currentTestPercentage,
		expectedSamplePerVariant,
		minimumSamplePerVariant,
		statisticalPower,
		warnings,
		recommendations,
	};
}

function validateTestConfiguration(
	totalSubscribers: number,
	testPercentage: number,
	variantCount: number,
	ignoreWarnings: boolean = false,
): TestValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	if (totalSubscribers < 1) {
		errors.push("Total subscribers must be greater than 0");
	}

	if (testPercentage < 1 || testPercentage > 100) {
		errors.push("Test group percentage must be between 1% and 100%");
	}

	if (variantCount < 2 || variantCount > 3) {
		errors.push("Variant count must be between 2 and 3");
	}

	const sampleSizeRecommendation = getSampleSizeRecommendation(
		totalSubscribers,
		testPercentage,
		variantCount,
	);

	if (!ignoreWarnings) {
		warnings.push(...sampleSizeRecommendation.warnings);
	}

	return {
		isValid: errors.length === 0,
		errors,
		warnings,
		sampleSizeRecommendation,
	};
}

export const StatisticalUtils = {
	calculateMinimumSampleSize,
	getSampleSizeRecommendation,
	validateTestConfiguration,
};
