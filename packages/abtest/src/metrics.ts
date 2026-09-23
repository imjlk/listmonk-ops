import type { ListmonkClient } from "@listmonk-ops/openapi";
import type { AbTest, TestResults } from "./types";
import type { ConversionEventStore } from "./conversion-events";

/**
 * Metrics collection for A/B test analysis.
 *
 * The previous implementation logged and swallowed Listmonk errors,
 * returning `Math.random()`-based mock data, which silently produced fake
 * winners in production. This module replaces that with a typed
 * `MetricsCollector` interface whose Listmonk implementation fails closed:
 * if any backing campaign fetch errors, collection throws
 * `AbTestMetricsUnavailableError` rather than returning partial results
 * that could be mistaken for a real signal.
 *
 * Conversion tracking is intentionally separated from click tracking. The
 * previous code copied `clicks` into `conversions`; the production collector
 * now reads a durable conversion event store instead.
 */

export interface CampaignMapping {
	variantId: string;
	campaignId: number;
}

export interface MetricsCollector {
	collect(test: AbTest): Promise<TestResults[]>;
}

export class AbTestMetricsUnavailableError extends Error {
	readonly testId: string;
	// `cause` is a built-in property of Error (ES2022). Use `declare` so the
	// constructor's super(... { cause }) assignment types correctly without a
	// conflicting parameter-property declaration.
	declare readonly cause: unknown;

	constructor(testId: string, cause: unknown) {
		const causeMessage =
			cause instanceof Error ? cause.message : String(cause);
		// Always forward `cause` (even when it is not an Error) so the
		// declared `cause: unknown` matches the runtime value and callers
		// can inspect the original thrown value regardless of its type.
		super(`Metrics unavailable for A/B test ${testId}: ${causeMessage}`, {
			cause,
		});
		this.name = "AbTestMetricsUnavailableError";
		this.testId = testId;
	}
}

/**
 * Collect per-variant campaign metrics from Listmonk.
 *
 * Reads `sent`, `views`, and `clicks` from each backing campaign. `opens`
 * maps to `views`, `clicks` to `clicks`, and the denominator is `sent`.
 * When an event store is configured, conversions count distinct subscriber
 * UUIDs and revenue sums event values. Without a store, conversions are zero
 * (primarily useful for isolated collector tests).
 *
 * If any campaign fetch fails, the entire collection throws
 * `AbTestMetricsUnavailableError`. No partial results are returned.
 */
export class ListmonkMetricsCollector implements MetricsCollector {
	constructor(
		private readonly client: ListmonkClient,
		private readonly conversionEvents?: ConversionEventStore,
	) {}

	async collect(test: AbTest): Promise<TestResults[]> {
		if (test.campaignMappings.length === 0) {
			throw new AbTestMetricsUnavailableError(
				test.id,
				new Error("test has no backing campaign mappings"),
			);
		}

		// Fetch every backing campaign in parallel. Each fetch is independent,
		// and Promise.all rejects on the first failure, which preserves the
		// fail-closed semantics (no partial results escape) while improving
		// latency when multiple variants exist.
		let conversionByVariant = new Map<string, Awaited<ReturnType<ConversionEventStore["aggregate"]>>[number]>();
		let revenueCurrency: string | undefined;
		try {
			const aggregates = await this.conversionEvents?.aggregate(test.id) ?? [];
			const currencies = new Set(
				aggregates.map((aggregate) => aggregate.currency).filter(
					(currency) => currency !== undefined,
				),
			);
			if (currencies.size > 1) {
				throw new Error(
					`A/B test ${test.id} contains mixed revenue currencies`,
				);
			}
			revenueCurrency = currencies.values().next().value;
			conversionByVariant = new Map(aggregates.map((aggregate) => [aggregate.variantId, aggregate]));
		} catch (error) {
			throw new AbTestMetricsUnavailableError(test.id, error);
		}
		const results = await Promise.all(
			test.campaignMappings.map(async (mapping): Promise<TestResults> => {
				try {
					const response = await this.client.campaign.getById({
						path: { id: mapping.campaignId },
					});
					if ("error" in response || response.data === undefined) {
						throw new Error(
							`campaign ${mapping.campaignId} returned no data${
								"error" in response ? `: ${String(response.error)}` : ""
							}`,
						);
					}
					const campaign = response.data;
					const sampleSize = campaign.sent ?? 0;
					const opens = campaign.views ?? 0;
					const clicks = campaign.clicks ?? 0;
					// Conversion events are separate from Listmonk click counts.
					const aggregate = conversionByVariant.get(mapping.variantId);
					const conversions = aggregate?.uniqueSubscribers ?? 0;
					if (conversions > sampleSize) {
						throw new Error(`variant ${mapping.variantId} has ${conversions} converters but only ${sampleSize} sent recipients`);
					}

					return {
						variantId: mapping.variantId,
						sampleSize,
						opens,
						clicks,
						conversions,
						...(revenueCurrency === undefined ? {} : { revenue: aggregate?.totalValue ?? 0, currency: revenueCurrency }),
						openRate: sampleSize > 0 ? (opens / sampleSize) * 100 : 0,
						clickRate: sampleSize > 0 ? (clicks / sampleSize) * 100 : 0,
						conversionRate: sampleSize > 0 ? (conversions / sampleSize) * 100 : 0,
					};
				} catch (error) {
					throw new AbTestMetricsUnavailableError(test.id, error);
				}
			}),
		);

		return results;
	}
}

/**
 * Test-only simulated metrics collector. Deliberately NOT wired into the
 * production factory; tests must inject it explicitly when they need
 * deterministic metrics without a live Listmonk.
 */
export class SimulatedMetricsCollector implements MetricsCollector {
	constructor(private readonly resultsByTestId: Map<string, TestResults[]>) {}

	async collect(test: AbTest): Promise<TestResults[]> {
		const results = this.resultsByTestId.get(test.id);
		if (!results) {
			throw new AbTestMetricsUnavailableError(
				test.id,
				new Error("no simulated results registered for this test"),
			);
		}
		// Return shallow copies so tests cannot mutate the registered fixture's
		// primitive fields. TestResults currently holds only primitives, so a
		// shallow copy is sufficient; switch to structuredClone if a nested
		// object/array field is ever added.
		return results.map((result) => ({ ...result }));
	}
}
