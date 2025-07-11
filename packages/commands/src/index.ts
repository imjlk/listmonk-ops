import type {
	AbTest,
	AbTestConfig,
	AbTestService,
	StatisticalAnalysis,
	TestAnalysis,
	TestResults,
} from "@listmonk-ops/abtest";
import { ValidationError } from "@listmonk-ops/common";
import type { Campaign, List } from "@listmonk-ops/openapi";

// Generic Listmonk client interface for commands
interface ListmonkClient {
	getCampaigns(): Promise<{
		data: {
			results: Campaign[];
			total: number;
			per_page: number;
			page: number;
		};
		request: Request;
		response: Response;
	}>;
	getCampaignById(params: { path: { campaign_id: number } }): Promise<
		| {
				data: Campaign;
				request: Request;
				response: Response;
		  }
		| { error: unknown }
	>;
	getLists(): Promise<{
		data: {
			results: List[];
			total: number;
			per_page: number;
			page: number;
		};
		request: Request;
		response: Response;
	}>;
	getListById(params: { path: { list_id: number } }): Promise<
		| {
				data: List;
				request: Request;
				response: Response;
		  }
		| { error: unknown }
	>;
}

// Base Command interface
export interface Command<TInput, TOutput> {
	execute(input: TInput): Promise<TOutput>;
}

export abstract class BaseCommand<TInput, TOutput>
	implements Command<TInput, TOutput>
{
	abstract execute(input: TInput): Promise<TOutput>;

	protected validate(_input: TInput): void {
		// Common validation logic can be implemented here
	}
}

// A/B Test Commands
export class CreateAbTestCommand extends BaseCommand<AbTestConfig, AbTest> {
	constructor(private abTestService: AbTestService) {
		super();
	}

	async execute(input: AbTestConfig): Promise<AbTest> {
		this.validate(input);
		return this.abTestService.createTest(input);
	}

	protected override validate(input: AbTestConfig): void {
		if (!input.name || input.name.trim().length === 0) {
			throw new ValidationError("Test name is required");
		}
		if (input.variants.length < 2) {
			throw new ValidationError("At least 2 variants required");
		}
		if (input.variants.length > 3) {
			throw new ValidationError("Maximum 3 variants allowed (A/B/C testing)");
		}

		// Validate percentage distribution
		const totalPercentage = input.variants.reduce(
			(sum, variant) => sum + variant.percentage,
			0,
		);
		if (Math.abs(totalPercentage - 100) > 0.01) {
			throw new ValidationError(
				`Variant percentages must sum to 100%, got ${totalPercentage}%`,
			);
		}
	}
}

export class AnalyzeAbTestCommand extends BaseCommand<string, TestAnalysis> {
	constructor(private abTestService: AbTestService) {
		super();
	}

	async execute(testId: string): Promise<TestAnalysis> {
		this.validate(testId);

		const results = await this.abTestService.getTestResults(testId);
		const analysis =
			await this.abTestService.analyzeStatisticalSignificance(results);

		// Find the best performing variant
		const bestVariant = results.reduce((best, current) =>
			current.conversionRate > best.conversionRate ? current : best,
		);

		return {
			testId,
			results,
			analysis,
			winner: analysis.isSignificant
				? this.findVariantById(bestVariant.variantId)
				: null,
			recommendations: this.generateRecommendations(analysis, bestVariant),
		};
	}

	protected override validate(testId: string): void {
		if (!testId || testId.trim().length === 0) {
			throw new ValidationError("Test ID is required");
		}
	}

	private findVariantById(_variantId: string) {
		// TODO: Implement variant lookup
		// For now, return null since we need to access the original test data
		return null;
	}

	private generateRecommendations(
		analysis: StatisticalAnalysis,
		bestVariant: TestResults,
	): string[] {
		if (analysis.isSignificant) {
			return [
				`Variant with ${bestVariant.conversionRate.toFixed(2)}% conversion rate is the winner!`,
				"Deploy to full audience.",
				`Confidence level: ${(analysis.confidenceLevel * 100).toFixed(1)}%`,
			];
		} else {
			return [
				"Not statistically significant yet.",
				"Continue testing to gather more data.",
				`Current p-value: ${analysis.pValue.toFixed(4)}`,
			];
		}
	}
}

// Campaign Commands
export class ListCampaignsCommand extends BaseCommand<void, Campaign[]> {
	constructor(private listmonkClient: ListmonkClient) {
		super();
	}

	async execute(): Promise<Campaign[]> {
		const result = await this.listmonkClient.getCampaigns();
		return result.data.results;
	}
}

export class GetCampaignCommand extends BaseCommand<string, Campaign> {
	constructor(private listmonkClient: ListmonkClient) {
		super();
	}

	async execute(campaignId: string): Promise<Campaign> {
		this.validate(campaignId);
		const result = await this.listmonkClient.getCampaignById({
			path: { campaign_id: Number(campaignId) },
		});

		if ("error" in result) {
			throw new ValidationError(`Campaign with ID ${campaignId} not found`);
		}

		return result.data;
	}

	protected override validate(campaignId: string): void {
		if (!campaignId || campaignId.trim().length === 0) {
			throw new ValidationError("Campaign ID is required");
		}
		const id = Number(campaignId);
		if (Number.isNaN(id) || id <= 0) {
			throw new ValidationError("Campaign ID must be a positive number");
		}
	}
}

// List Commands
export class ListSubscriberListsCommand extends BaseCommand<void, List[]> {
	constructor(private listmonkClient: ListmonkClient) {
		super();
	}

	async execute(): Promise<List[]> {
		const result = await this.listmonkClient.getLists();
		return result.data.results;
	}
}

export class GetSubscriberListCommand extends BaseCommand<string, List> {
	constructor(private listmonkClient: ListmonkClient) {
		super();
	}

	async execute(listId: string): Promise<List> {
		this.validate(listId);
		const result = await this.listmonkClient.getListById({
			path: { list_id: Number(listId) },
		});

		if ("error" in result) {
			throw new ValidationError(`List with ID ${listId} not found`);
		}

		return result.data;
	}

	protected override validate(listId: string): void {
		if (!listId || listId.trim().length === 0) {
			throw new ValidationError("List ID is required");
		}
		const id = Number(listId);
		if (Number.isNaN(id) || id <= 0) {
			throw new ValidationError("List ID must be a positive number");
		}
	}
}

// Command executors using factory functions
export function createCommandExecutors(
	abTestService: AbTestService,
	listmonkClient: ListmonkClient,
) {
	return {
		// A/B Test Commands
		createAbTest: (config: AbTestConfig): Promise<AbTest> =>
			new CreateAbTestCommand(abTestService).execute(config),

		analyzeAbTest: (testId: string): Promise<TestAnalysis> =>
			new AnalyzeAbTestCommand(abTestService).execute(testId),

		// Campaign Commands
		listCampaigns: (): Promise<Campaign[]> =>
			new ListCampaignsCommand(listmonkClient).execute(),

		getCampaign: (id: string): Promise<Campaign> =>
			new GetCampaignCommand(listmonkClient).execute(id),

		// List Commands
		listSubscriberLists: (): Promise<List[]> =>
			new ListSubscriberListsCommand(listmonkClient).execute(),

		getSubscriberList: (id: string): Promise<List> =>
			new GetSubscriberListCommand(listmonkClient).execute(id),
	};
}
