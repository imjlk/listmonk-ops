import type { ListmonkClient } from "@listmonk-ops/openapi";
import { AbTestService } from "./abtest-service";
import {
	AnalyzeAbTestCommand,
	CreateAbTestCommand,
	DeleteAbTestCommand,
	GetAbTestCommand,
	ListAbTestsCommand,
} from "./basic";
import { ListmonkAbTestIntegration } from "./listmonk-integration";
import { ListmonkMetricsCollector } from "./metrics";
import { cancelAbTest } from "./lifecycle";
import { AbTestNotFoundError } from "./errors";
import type {
	AbTest,
	AbTestQueryParams,
	AnalyzeAbTestInput,
	CreateAbTestInput,
	TestAnalysis,
} from "./types";

// A/B Test command executors factory with Listmonk integration
export function createAbTestExecutors(listmonkClient: ListmonkClient) {
	// Create Listmonk integration
	const listmonkIntegration = new ListmonkAbTestIntegration(listmonkClient);

	// Create A/B test service with Listmonk integration. Wire the
	// ListmonkMetricsCollector so production uses the same fail-closed
	// collector that tests exercise, rather than the legacy
	// collectTestResults path on the integration.
	const metricsCollector = new ListmonkMetricsCollector(listmonkClient);
	const abTestService = new AbTestService(
		listmonkIntegration,
		metricsCollector,
	);
	return {
		// Basic CRUD operations
		listAbTests: (params?: AbTestQueryParams): Promise<AbTest[]> =>
			new ListAbTestsCommand(abTestService).execute(params || {}),

		getAbTest: (testId: string): Promise<AbTest> =>
			new GetAbTestCommand(abTestService).execute(testId),

		createAbTest: (input: CreateAbTestInput): Promise<AbTest> =>
			new CreateAbTestCommand(abTestService).execute(input),

		deleteAbTest: (testId: string): Promise<boolean> =>
			new DeleteAbTestCommand(abTestService).execute(testId),

		// Analysis operations
		analyzeAbTest: (input: AnalyzeAbTestInput): Promise<TestAnalysis> =>
			new AnalyzeAbTestCommand(abTestService).execute(input),

		analyzeAbTestSimple: (testId: string): Promise<TestAnalysis> =>
			new AnalyzeAbTestCommand(abTestService).execute({
				test_id: testId,
				include_recommendations: true,
			}),

		// Advanced operations
		launchAbTest: async (testId: string) => {
			const test = await abTestService.getTest(testId);
			if (!test) {
				throw new AbTestNotFoundError(testId);
			}

			if (test.status !== "draft" && test.status !== "scheduled") {
				throw new Error(
					`Test ${testId} is not in draft or scheduled status (current: ${test.status})`,
				);
			}

			// Compute the shared send_at for all variant campaigns. Prefer
			// the test's launchAt; otherwise use now + 60s safety lead time
			// so all variants send simultaneously rather than sequentially.
			const DEFAULT_SAFETY_LEAD_SECONDS = 60;
			const sendAt =
				test.launchAt ??
				new Date(
					Date.now() + DEFAULT_SAFETY_LEAD_SECONDS * 1000,
				).toISOString();

			// Launch with the shared send_at so every variant campaign
			// transitions to 'scheduled' simultaneously.
			await listmonkIntegration.launchTest(
				test.campaignMappings,
				test.testListMappings,
				{ sendAt },
			);

			// Record the startedAt and compute endsAt from durationHours.
			const startedAt = new Date().toISOString();
			test.startedAt = startedAt;
			if (test.durationHours !== undefined) {
				test.endsAt = new Date(
					Date.now() + test.durationHours * 3600 * 1000,
				).toISOString();
			}
			test.launchAt = sendAt;

			// The test is now scheduled — the campaigns will fire at sendAt.
			return await abTestService.updateTestStatus(testId, "scheduled");
		},

		stopAbTest: async (testId: string) => {
			const test = await abTestService.getTest(testId);
			if (!test) {
				throw new AbTestNotFoundError(testId);
			}

			if (test.status !== "running" && test.status !== "scheduled") {
				throw new Error(
					`Test ${testId} is not running or scheduled (current: ${test.status})`,
				);
			}

			// Stop via the status-aware lifecycle executor: it fetches each
			// backing campaign's remote status, cancels running campaigns,
			// deletes draft/scheduled ones (which cannot be cancelled on
			// Listmonk v6.2.0), leaves terminal campaigns in place, and only
			// deletes temporary lists when no campaign still references them.
			// This replaces the legacy cleanup paths that renamed campaigns
			// and ignored remote status.
			const result = await cancelAbTest(listmonkClient, test);

			// Hard failures (network error, permission denied, 5xx) or fetch
			// failures (could not read a campaign's status) mean the stop is
			// not authoritative — the test may still hold active resources.
			// Surface it rather than silently marking the test cancelled.
			if (result.hadFailures || result.hadFetchFailures) {
				const failedCampaigns = result.campaignResults.filter(
					(r) => r.outcome === "failed",
				).length;
				const failedLists = result.listResults.filter(
					(r) => r.outcome === "failed",
				).length;
				const reasons: string[] = [];
				if (result.hadFailures) {
					reasons.push(
						`${failedCampaigns} campaign action(s) and ${failedLists} list action(s) failed`,
					);
				}
				if (result.hadFetchFailures) {
					reasons.push("campaign status could not be verified");
				}
				throw new Error(
					`A/B test ${testId} stop is non-authoritative: ${reasons.join("; ")}; inspect remote resources before retrying`,
				);
			}

			// No hard failures, but some lists may have been intentionally
			// retained because campaigns survived (unobservable, or terminal
			// campaigns left for delivery history). Log them so operators
			// have a trace for reconciliation.
			if (result.hadRetainedResources) {
				const retained = result.listResults
					.filter((r) => r.outcome === "skipped_active_reference")
					.map((r) => r.listId);
				console.warn(
					`A/B test ${testId} cancelled with retained lists: ${retained.join(", ")}`,
				);
			}

			// Update test status to cancelled (stop is a terminal intent).
			return await abTestService.updateTestStatus(testId, "cancelled");
		},

		getTestResults: async (testId: string) => {
			return await abTestService.getTestResults(testId);
		},

		// Statistical analysis methods
		getSampleSizeRecommendation: async (
			lists: number[],
			testPercentage: number,
			variantCount: number = 2,
		) => {
			return await abTestService.getSampleSizeRecommendation(
				lists,
				testPercentage,
				variantCount,
			);
		},

		deployWinner: async (testId: string) => {
			return await abTestService.deployWinner(testId);
		},

		// Convenience methods for common A/B test scenarios
		createSimpleAbTest: async (params: {
			name: string;
			subjectA: string;
			subjectB: string;
			body: string;
			lists: number[];
			splitPercentage?: number;
		}) => {
			const splitPercentage = params.splitPercentage || 50;

			const input = {
				name: params.name,
				variants: [
					{
						name: "A (Control)",
						percentage: splitPercentage,
						campaign_config: {
							subject: params.subjectA,
							body: params.body,
						},
					},
					{
						name: "B (Treatment)",
						percentage: 100 - splitPercentage,
						campaign_config: {
							subject: params.subjectB,
							body: params.body,
						},
					},
				],
				lists: params.lists,
			};

			return await new CreateAbTestCommand(abTestService).execute(input);
		},

		createSubjectLineTest: async (params: {
			name: string;
			subjects: string[];
			body: string;
			lists: number[];
		}) => {
			if (params.subjects.length < 2 || params.subjects.length > 3) {
				throw new Error("Subject line test supports 2-3 variants");
			}

			const percentage = Math.floor(100 / params.subjects.length);
			const variants = params.subjects.map((subject, index) => ({
				name: `Variant ${String.fromCharCode(65 + index)}`,
				percentage:
					index === params.subjects.length - 1
						? 100 - percentage * (params.subjects.length - 1)
						: percentage,
				campaign_config: {
					subject,
					body: params.body,
				},
			}));

			const input = {
				name: params.name,
				variants,
				lists: params.lists,
			};

			return await new CreateAbTestCommand(abTestService).execute(input);
		},

		// Service instances for advanced usage
		abTestService,
		listmonkIntegration,
	};
}

// Export factory function type for type checking
export type AbTestExecutors = ReturnType<typeof createAbTestExecutors>;
