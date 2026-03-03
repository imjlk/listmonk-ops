import { ValidationError } from "@listmonk-ops/common";
import type { AbTestService } from "./abtest-service";
import type {
	AbTest,
	AbTestConfig,
	AbTestQueryParams,
	AnalyzeAbTestInput,
	CreateAbTestInput,
	TestAnalysis,
} from "./types";

// Simple A/B Test command wrappers (no longer extending BaseCommand)
export class CreateAbTestCommand {
	constructor(private abTestService: AbTestService) {}

	async execute(input: CreateAbTestInput): Promise<AbTest> {
		this.validate(input);

		// Convert CreateAbTestInput to AbTestConfig
		const config: AbTestConfig = {
			name: input.name,
			campaignId: input.campaign_id || `campaign-${Date.now()}`,
			variants: input.variants.map((v, index) => ({
				id: `variant-${index}`,
				name: v.name,
				percentage: v.percentage,
				contentOverrides: {
					subject: v.campaign_config.subject,
					body: v.campaign_config.body,
				},
			})),
			metrics: [
				{ name: "Open Rate", type: "open_rate" },
				{ name: "Click Rate", type: "click_rate" },
			],
			baseConfig: {
				subject: input.variants[0]?.campaign_config.subject || "",
				body: input.variants[0]?.campaign_config.body || "",
				lists: input.lists,
				template_id: input.variants[0]?.campaign_config.template_id,
			},
			testingMode: input.testing_mode || "holdout",
			testGroupPercentage: input.test_group_percentage || 10,
			confidenceThreshold: input.confidence_threshold || 0.95,
			autoDeployWinner: input.auto_deploy_winner || false,
		};

		return await this.abTestService.createTest(config);
	}

	private validate(input: CreateAbTestInput): void {
		if (!input.name || input.name.trim().length === 0) {
			throw new ValidationError("Test name is required");
		}

		if (!input.variants || input.variants.length < 2) {
			throw new ValidationError(
				"At least 2 variants are required for A/B testing",
			);
		}

		if (input.variants.length > 3) {
			throw new ValidationError("Maximum 3 variants supported (A/B/C testing)");
		}

		// Validate percentage distribution
		const totalPercentage = input.variants.reduce(
			(sum, variant) => sum + variant.percentage,
			0,
		);

		if (Math.abs(totalPercentage - 100) > 0.01) {
			throw new ValidationError(
				`Variant percentages must sum to 100%. Current total: ${totalPercentage}%`,
			);
		}

		// Validate each variant
		for (const variant of input.variants) {
			if (!variant.name || variant.name.trim().length === 0) {
				throw new ValidationError("All variants must have a name");
			}

			if (variant.percentage <= 0 || variant.percentage > 100) {
				throw new ValidationError(
					"Variant percentages must be between 0 and 100",
				);
			}
		}

		if (!input.lists || input.lists.length === 0) {
			throw new ValidationError("At least one list is required");
		}
	}
}

export class AnalyzeAbTestCommand {
	constructor(private abTestService: AbTestService) {}

	async execute(input: AnalyzeAbTestInput): Promise<TestAnalysis> {
		this.validate(input);
		return await this.abTestService.analyzeTest(input.test_id);
	}

	private validate(input: AnalyzeAbTestInput): void {
		if (!input.test_id || input.test_id.trim().length === 0) {
			throw new ValidationError("Test ID is required for analysis");
		}
	}
}

export class ListAbTestsCommand {
	constructor(private abTestService: AbTestService) {}

	async execute(_params: AbTestQueryParams): Promise<AbTest[]> {
		// Simple implementation - ignore params for now and return all tests
		return await this.abTestService.getAllTests();
	}
}

export class GetAbTestCommand {
	constructor(private abTestService: AbTestService) {}

	async execute(testId: string): Promise<AbTest> {
		this.validate(testId);
		const test = await this.abTestService.getTest(testId);
		if (!test) {
			throw new ValidationError(`Test with ID ${testId} not found`);
		}
		return test;
	}

	private validate(testId: string): void {
		if (!testId || testId.trim().length === 0) {
			throw new ValidationError("Test ID is required");
		}
	}
}

export class DeleteAbTestCommand {
	constructor(private abTestService: AbTestService) {}

	async execute(testId: string): Promise<boolean> {
		this.validate(testId);
		return await this.abTestService.deleteTest(testId);
	}

	private validate(testId: string): void {
		if (!testId || testId.trim().length === 0) {
			throw new ValidationError("Test ID is required");
		}
	}
}
