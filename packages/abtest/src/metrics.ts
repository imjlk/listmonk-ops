import type { ListmonkClient } from "@listmonk-ops/openapi";
import type { AbTest, TestResults } from "./types";

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
 * previous code copied `clicks` into `conversions`, which conflated two
 * different metrics and made "conversion rate" mean "click rate". Until a
 * dedicated conversion event store exists (planned PR-4), conversions are
 * reported as zero with an explicit note that conversion_rate is not yet
 * measured.
 */

export interface CampaignMapping {
	variantId: string;
	campaignId: number;
}

export interface MetricsCollector {
	collect(test: AbTest): Promise<TestResults[]>;
}

export class AbTestMetricsUnavailableError extends Error {
	constructor(
		readonly testId: string,
		readonly cause: unknown,
	) {
		const causeMessage =
			cause instanceof Error ? cause.message : String(cause);
		super(
			`Metrics unavailable for A/B test ${testId}: ${causeMessage}`,
			cause instanceof Error ? { cause } : undefined,
		);
		this.name = "AbTestMetricsUnavailableError";
	}
}

/**
 * Collect per-variant campaign metrics from Listmonk.
 *
 * Reads `sent`, `views`, and `clicks` from each backing campaign. `opens`
 * maps to `views`, `clicks` to `clicks`, and the denominator is `sent`.
 * `conversions` is reported as 0 because conversion attribution requires a
 * dedicated event store that does not exist yet; callers must not treat
 * `conversionRate` as a measured signal until that lands.
 *
 * If any campaign fetch fails, the entire collection throws
 * `AbTestMetricsUnavailableError`. No partial results are returned.
 */
export class ListmonkMetricsCollector implements MetricsCollector {
	constructor(private readonly client: ListmonkClient) {}

	async collect(test: AbTest): Promise<TestResults[]> {
		if (test.campaignMappings.length === 0) {
			throw new AbTestMetricsUnavailableError(
				test.id,
				new Error("test has no backing campaign mappings"),
			);
		}

		const results: TestResults[] = [];
		for (const mapping of test.campaignMappings) {
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
				// Conversions are NOT click-through. Until a conversion event
				// store is wired in, conversions stay at zero so analysis does
				// not mistake clicks for conversions.
				const conversions = 0;

				results.push({
					variantId: mapping.variantId,
					sampleSize,
					opens,
					clicks,
					conversions,
					openRate: sampleSize > 0 ? (opens / sampleSize) * 100 : 0,
					clickRate: sampleSize > 0 ? (clicks / sampleSize) * 100 : 0,
					conversionRate: 0,
				});
			} catch (error) {
				throw new AbTestMetricsUnavailableError(test.id, error);
			}
		}

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
		// Return deep copies so tests cannot mutate the registered fixture.
		return results.map((result) => ({ ...result }));
	}
}
