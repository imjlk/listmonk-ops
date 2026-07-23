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
import { ABTEST_SAFETY_LEAD_SECONDS } from "./types";

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

	const TERMINAL_STATUSES: ReadonlySet<AbTest["status"]> = new Set([
		"completed",
		"inconclusive",
		"cancelled",
		"failed",
	]);

	// Launch is shared between the manual launchAbTest method and the
	// orchestration runAbTest step, so define it once as a named helper.
	const launchAbTestImpl = async (
		testId: string,
	): Promise<AbTest | null> => {
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
		// the test's launchAt; otherwise use now + safety lead time
		// so all variants send simultaneously rather than sequentially.
		const sendAt =
			test.launchAt ??
			new Date(
				Date.now() + ABTEST_SAFETY_LEAD_SECONDS * 1000,
			).toISOString();

		// Launch with the shared send_at so every variant campaign
		// transitions to 'scheduled' simultaneously.
		await listmonkIntegration.launchTest(
			test.campaignMappings,
			test.testListMappings,
			{ sendAt },
		);

			// Record timestamps. startedAt marks when the launch was initiated;
			// endsAt is computed from sendAt (when campaigns actually fire),
			// not Date.now(), so the test end aligns with the actual send time.
		const startedAt = new Date().toISOString();
		test.startedAt = startedAt;
		if (test.durationHours !== undefined) {
			test.endsAt = new Date(
					new Date(sendAt).getTime() + test.durationHours * 3600 * 1000,
				).toISOString();
		}
		test.launchAt = sendAt;

		// The test is now scheduled — the campaigns will fire at sendAt.
		return await abTestService.updateTestStatus(testId, "scheduled");
	};

	const stopAbTestImpl = async (
		testId: string,
	): Promise<AbTest | null> => {
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
	};

	// Orchestration operations. These are intentionally lightweight stubs
	// that perform a single status-based progression step; full scheduling,
	// duration checks, and reconciliation logic land in later stages.
	const runAbTestImpl = async (
		testId: string,
	): Promise<AbTest | null> => {
		const test = await abTestService.getTest(testId);
		if (!test) {
			throw new AbTestNotFoundError(testId);
		}

		if (TERMINAL_STATUSES.has(test.status)) {
			return test;
		}

		// Progress the test one step based on its current status. This
		// delegates to the existing lifecycle methods so the orchestration
		// layer stays consistent with the manual launch/stop paths.
		switch (test.status) {
			case "draft": {
				// Only auto-launch drafts that were created with autoLaunch.
				// A plain draft must be launched explicitly.
				return test;
			}
			case "scheduled": {
				// Do not re-launch an already-scheduled test. Wait until the
				// sendAt/launchAt time has passed, then advance to running
				// so the next tick can move it to analyzing.
				const now = Date.now();
				const launchTime = test.launchAt
					? new Date(test.launchAt).getTime()
					: Number.POSITIVE_INFINITY;
				if (now >= launchTime) {
					return await abTestService.updateTestStatus(testId, "running");
				}
				return test;
			}
			case "running": {
				// A running test has reached its send window; advance it to
				// analyzing so the next tick can pick up metrics. Check endsAt
				// if set so we don't analyze prematurely.
				const now = Date.now();
				const endTime = test.endsAt ? new Date(test.endsAt).getTime() : 0;
				if (endTime === 0 || now >= endTime) {
					return await abTestService.updateTestStatus(testId, "analyzing");
				}
				return test;
			}
			case "analyzing": {
				// Run analysis, then deploy the winner if configured for a
				// holdout test, or mark inconclusive/completed based on the
				// significance result. Full-split tests do not support
				// winner deployment.
				const analysis = await abTestService.analyzeTest(testId);
				if (
					test.autoDeployWinner &&
					analysis.winner &&
					test.testingMode === "holdout"
				) {
					await abTestService.deployWinner(testId);
					return await abTestService.updateTestStatus(testId, "completed");
				}
				return await abTestService.updateTestStatus(
					testId,
					analysis.analysis.isSignificant ? "completed" : "inconclusive",
				);
			}
			default: {
				// `testing`, `deploying`, and `cancelling` are transitional
				// states that this stub does not drive yet.
				return test;
			}
		}
	};

	const tickAbTestsImpl = async (
		dryRun: boolean,
	): Promise<
		Array<{
			test_id: string;
			status: AbTest["status"];
			action: string;
		}>
	> => {
		const tests = await abTestService.getAllTests();
		const results: Array<{
			test_id: string;
			status: AbTest["status"];
			action: string;
		}> = [];
		for (const test of tests) {
			if (TERMINAL_STATUSES.has(test.status)) {
				continue;
			}
			// Skip plain drafts — they must be launched explicitly. Only
			// scheduled/running/analyzing tests are progressed by tick.
			if (test.status === "draft") {
				results.push({
					test_id: test.id,
					status: test.status,
					action: "skip:draft-not-launched",
				});
				continue;
			}
			if (dryRun) {
				// Report what would happen without mutating state.
				results.push({
					test_id: test.id,
					status: test.status,
					action: `dry-run:would-progress:${test.status}`,
				});
				continue;
			}
			const action = `progress:${test.status}`;
			try {
				const updated = await runAbTestImpl(test.id);
				results.push({
					test_id: test.id,
					status: updated?.status ?? test.status,
					action,
				});
			} catch (error) {
				// Keep ticking even if one test fails so operators see every
				// progression attempt in a single report.
				results.push({
					test_id: test.id,
					status: test.status,
					action: `error:${error instanceof Error ? error.message : String(error)}`,
				});
			}
		}
		return results;
	};

	const reconcileAbTestImpl = async (
		testId?: string,
		repair: boolean = false,
	): Promise<
		Array<{
			test_id: string;
			status: AbTest["status"];
			drift: string;
		}>
	> => {
		const tests = testId
			? [
					(() => {
						const found = abTestService
							.snapshotTests()
							.find((candidate) => candidate.id === testId);
						if (!found) {
							throw new AbTestNotFoundError(testId);
						}
						return found;
					})(),
				]
			: abTestService.snapshotTests();

		const results: Array<{
			test_id: string;
			status: AbTest["status"];
			drift: string;
		}> = [];

		for (const test of tests) {
			// Simple drift heuristic: terminal tests are expected to have no
			// future endsAt; non-terminal tests are expected to have a
			// startedAt once they reach running/analyzing. Full drift
			// detection lands later.
			let drift = "none";
			if (
				!TERMINAL_STATUSES.has(test.status) &&
				!test.startedAt &&
				(test.status === "running" || test.status === "analyzing")
			) {
				drift = "missing_startedAt";
				if (repair) {
					test.startedAt = new Date().toISOString();
					drift = "repaired:startedAt";
				}
			} else if (
				TERMINAL_STATUSES.has(test.status) &&
				test.endsAt &&
				new Date(test.endsAt).getTime() > Date.now()
			) {
				drift = "terminal_with_future_endsAt";
				if (repair) {
					test.endsAt = undefined;
					drift = "repaired:endsAt";
				}
			}
			results.push({
				test_id: test.id,
				status: test.status,
				drift,
			});
		}
		return results;
	};

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
		launchAbTest: launchAbTestImpl,

		stopAbTest: stopAbTestImpl,

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

		// Orchestration operations exposed to the shared operation executors.
		runAbTest: runAbTestImpl,
		tickAbTests: (dryRun: boolean = false) => tickAbTestsImpl(dryRun),
		reconcileAbTest: (testId?: string, repair: boolean = false) =>
			reconcileAbTestImpl(testId, repair),

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
