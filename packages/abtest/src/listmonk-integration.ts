import type { ListmonkClient } from "@listmonk-ops/openapi";
import type { AbTest, TestResults, Variant } from "./types";
import {
	allocateByLargestRemainder,
	allocateTestAndHoldout,
} from "./allocation";
import {
	createListmonkAudienceResolver,
	type AudienceMember,
} from "./audience";
import { AbTestMetricsUnavailableError } from "./metrics";

export interface ProvisionedAbTestResources {
	testId: string;
	campaignIds: number[];
	testListIds: number[];
	holdoutListId?: number;
}

/**
 * Listmonk integration for A/B testing
 * Handles actual campaign creation, subscriber segmentation, and result collection
 */
export class ListmonkAbTestIntegration {
	constructor(private listmonkClient: ListmonkClient) {}

	private formatError(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}

	private unwrapData<T>(
		response: {
			data?: T;
			error?: unknown;
		},
		context: string,
	): T {
		if ("error" in response && response.error !== undefined) {
			throw new Error(`${context}: ${this.formatError(response.error)}`);
		}

		if (response.data === undefined) {
			throw new Error(`${context}: received empty data`);
		}

		return response.data;
	}

	private requireNumericId(value: unknown, context: string): number {
		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}

		throw new Error(`${context}: response missing numeric id`);
	}

	private async deleteCampaignsBestEffort(
		campaignIds: number[],
	): Promise<void> {
		for (const campaignId of campaignIds) {
			try {
				await this.listmonkClient.campaign.delete({
					path: { id: campaignId },
				});
			} catch (error) {
				console.warn(
					`Failed to delete rollback campaign ${campaignId}:`,
					error,
				);
			}
		}
	}

	private async deleteListsBestEffort(listIds: number[]): Promise<void> {
		for (const listId of listIds) {
			try {
				await this.listmonkClient.list.delete({
					path: { list_id: listId },
				});
			} catch (error) {
				console.warn(`Failed to delete rollback list ${listId}:`, error);
			}
		}
	}

	/**
	 * Creates actual Listmonk campaigns for A/B test variants
	 */
	async createTestCampaigns(
		abTest: AbTest,
		baseConfig: {
			subject: string;
			body: string;
			lists: number[];
			template_id?: number;
		},
	): Promise<{ variantId: string; campaignId: number }[]> {
		const createdCampaigns: { variantId: string; campaignId: number }[] = [];

		try {
			for (const variant of abTest.variants) {
				const campaignData = {
					body: {
						name: `${abTest.name} - ${variant.name}`,
						subject: variant.contentOverrides.subject || baseConfig.subject,
						body: variant.contentOverrides.body || baseConfig.body,
						lists: baseConfig.lists,
						type: "regular" as const,
						content_type: "html" as const,
						template_id: baseConfig.template_id,
						tags: [`abtest:${abTest.id}`, `variant:${variant.id}`],
					},
				};

				const result = await this.listmonkClient.campaign.create(campaignData);
				const createdCampaign = this.unwrapData(
					result,
					`Failed to create campaign for variant ${variant.name}`,
				);

				createdCampaigns.push({
					variantId: variant.id,
					campaignId: this.requireNumericId(
						createdCampaign.id,
						`Failed to create campaign for variant ${variant.name}`,
					),
				});
			}

			return createdCampaigns;
		} catch (error) {
			await this.deleteCampaignsBestEffort(
				createdCampaigns.map((entry) => entry.campaignId),
			);
			throw error;
		}
	}

	/**
	 * Segments subscribers for holdout A/B testing
	 * Creates test groups (small %) and holdout group (large %)
	 */
	async segmentSubscribersForHoldout(
		originalLists: number[],
		variants: Variant[],
		testGroupPercentage: number = 10,
	): Promise<{
		testListMappings: { variantId: string; listId: number }[];
		holdoutListId: number;
		testGroupSize: number;
		holdoutGroupSize: number;
	}> {
		const createdListIds: number[] = [];
		let holdoutListId: number | undefined;

		// Get all subscribers from original lists
		const allSubscribers = await this.getAllSubscribers(originalLists);
		const totalSubscribers = allSubscribers.length;

		// Exact test/holdout split via largest-remainder, so the two sizes
		// always sum to the audience total regardless of rounding.
		const { testGroupSize, holdoutGroupSize } = allocateTestAndHoldout({
			audienceSize: totalSubscribers,
			testGroupPercentage,
		});

		// Variant-level sizes also via largest-remainder, using each variant's
		// declared percentage (instead of the old equal split that ignored
		// variant.percentage and dropped leftover recipients).
		const variantSizes = allocateByLargestRemainder({
			total: testGroupSize,
			weights: variants.map((variant) => variant.percentage),
		}).counts;

		// Shuffle subscribers for random distribution
		const shuffledSubscribers = this.shuffleArray([...allSubscribers]);

		// Split into test group and holdout group
		const testGroupSubscribers = shuffledSubscribers.slice(0, testGroupSize);
		const holdoutGroupSubscribers = shuffledSubscribers.slice(testGroupSize);

		// Create holdout list
		try {
			const holdoutListResult = await this.listmonkClient.list.create({
				body: {
					name: `A/B Test Holdout - ${Date.now()}`,
					type: "private",
					optin: "single",
					description:
						"Holdout group for A/B test - will receive winner variant",
				},
			});

			const createdHoldoutList = this.unwrapData(
				holdoutListResult,
				"Failed to create holdout list",
			);
			holdoutListId = this.requireNumericId(
				createdHoldoutList.id,
				"Failed to create holdout list",
			);
			createdListIds.push(holdoutListId);

			for (const subscriber of holdoutGroupSubscribers) {
				await this.addSubscriberToList(subscriber.id, holdoutListId);
			}

			const testListMappings: { variantId: string; listId: number }[] = [];

			let currentIndex = 0;
			for (const [variantIndex, variant] of variants.entries()) {
				const variantCount = variantSizes[variantIndex] ?? 0;
				const variantSubscribers = testGroupSubscribers.slice(
					currentIndex,
					currentIndex + variantCount,
				);

				const testListResult = await this.listmonkClient.list.create({
					body: {
						name: `A/B Test - ${variant.name} - ${Date.now()}`,
						type: "private",
						optin: "single",
						description: `Test group for A/B test variant ${variant.name}`,
					},
				});

				const createdTestList = this.unwrapData(
					testListResult,
					`Failed to create test list for variant ${variant.name}`,
				);
				const testListId = this.requireNumericId(
					createdTestList.id,
					`Failed to create test list for variant ${variant.name}`,
				);
				createdListIds.push(testListId);

				for (const subscriber of variantSubscribers) {
					await this.addSubscriberToList(subscriber.id, testListId);
				}

				testListMappings.push({
					variantId: variant.id,
					listId: testListId,
				});

				currentIndex += variantCount;
			}

			return {
				testListMappings,
				holdoutListId,
				testGroupSize,
				holdoutGroupSize,
			};
		} catch (error) {
			await this.deleteListsBestEffort([...createdListIds].reverse());
			throw error;
		}
	}

	/**
	 * Legacy method - kept for backward compatibility
	 * Segments subscribers for A/B testing
	 * Creates temporary lists for each variant
	 */
	async segmentSubscribers(
		originalLists: number[],
		variants: Variant[],
	): Promise<{ variantId: string; listId: number }[]> {
		const segmentedLists: { variantId: string; listId: number }[] = [];
		const createdListIds: number[] = [];

		// Get all subscribers from original lists
		const allSubscribers = await this.getAllSubscribers(originalLists);

		// Shuffle subscribers for random distribution
		const shuffledSubscribers = this.shuffleArray([...allSubscribers]);

		// Exact per-variant sizes via largest-remainder using each variant's
		// declared percentage; the previous Math.floor dropped the remainder
		// and could leave subscribers unassigned.
		const variantSizes = allocateByLargestRemainder({
			total: shuffledSubscribers.length,
			weights: variants.map((variant) => variant.percentage),
		}).counts;

		let currentIndex = 0;
		try {
			for (const [variantIndex, variant] of variants.entries()) {
				const variantCount = variantSizes[variantIndex] ?? 0;

				const variantSubscribers = shuffledSubscribers.slice(
					currentIndex,
					currentIndex + variantCount,
				);

				const listResult = await this.listmonkClient.list.create({
					body: {
						name: `A/B Test - ${variant.name} - ${Date.now()}`,
						type: "private",
						optin: "single",
						description: `Temporary list for A/B test variant ${variant.name}`,
					},
				});

				const createdList = this.unwrapData(
					listResult,
					`Failed to create list for variant ${variant.name}`,
				);
				const listId = this.requireNumericId(
					createdList.id,
					`Failed to create list for variant ${variant.name}`,
				);
				createdListIds.push(listId);

				for (const subscriber of variantSubscribers) {
					await this.addSubscriberToList(subscriber.id, listId);
				}

				segmentedLists.push({
					variantId: variant.id,
					listId,
				});

				currentIndex += variantCount;
			}

			return segmentedLists;
		} catch (error) {
			await this.deleteListsBestEffort([...createdListIds].reverse());
			throw error;
		}
	}

	async rollbackProvisioning(
		resources: ProvisionedAbTestResources,
	): Promise<void> {
		const listIds = [...resources.testListIds];
		if (resources.holdoutListId !== undefined) {
			listIds.push(resources.holdoutListId);
		}

		await this.deleteCampaignsBestEffort([...resources.campaignIds].reverse());
		await this.deleteListsBestEffort(listIds.reverse());
	}

	/**
	 * Deploys winner variant to holdout group
	 */
	async deployWinnerToHoldout(
		winnerVariant: Variant,
		holdoutListId: number,
		baseConfig: {
			subject: string;
			body: string;
			lists: number[];
			template_id?: number;
		},
		testId: string,
	): Promise<number> {
		// Create winner campaign for holdout group
		const winnerCampaignData = {
			body: {
				name: `A/B Test Winner - ${winnerVariant.name} - ${Date.now()}`,
				subject: winnerVariant.contentOverrides.subject || baseConfig.subject,
				body: winnerVariant.contentOverrides.body || baseConfig.body,
				lists: [holdoutListId],
				type: "regular" as const,
				content_type: "html" as const,
				template_id: baseConfig.template_id,
				tags: [
					`abtest:${testId}`,
					`variant:${winnerVariant.id}`,
					`winner:deployed`,
					`holdout:group`,
				],
			},
		};

		const result =
			await this.listmonkClient.campaign.create(winnerCampaignData);
		const createdWinnerCampaign = this.unwrapData(
			result,
			"Failed to create winner campaign",
		);

		return this.requireNumericId(
			createdWinnerCampaign.id,
			"Failed to create winner campaign",
		);
	}

	/**
	 * Automatically launches winner campaign to holdout group
	 */
	async autoDeployWinner(winnerCampaignId: number): Promise<void> {
		// Launch winner campaign
		await this.listmonkClient.campaign.updateStatus({
			path: { id: winnerCampaignId },
			body: {
				status: "running",
			},
		});
	}

	/**
	 * Collects actual test results from Listmonk campaigns
	 */
	async collectTestResults(
		testId: string,
		campaignMappings: { variantId: string; campaignId: number }[],
	): Promise<TestResults[]> {
		// Fail closed: any fetch failure aborts the whole collection with a
		// typed error rather than falling back to mock data. Conversions are
		// reported as zero; click-through is not a conversion proxy and a
		// dedicated conversion event store is required to measure them.
		if (campaignMappings.length === 0) {
			throw new AbTestMetricsUnavailableError(
				testId,
				new Error("test has no backing campaign mappings"),
			);
		}

		const results = await Promise.all(
			campaignMappings.map(async (mapping): Promise<TestResults> => {
				try {
					const campaignResult = await this.listmonkClient.campaign.getById({
						path: { id: mapping.campaignId },
					});
					const campaign = this.unwrapData(
						campaignResult,
						`Failed to get campaign ${mapping.campaignId}`,
					);

					const sampleSize = campaign.sent || 0;
					const opens = campaign.views || 0;
					const clicks = campaign.clicks || 0;
					const conversions = 0;

					return {
						variantId: mapping.variantId,
						sampleSize,
						opens,
						clicks,
						conversions,
						openRate: sampleSize > 0 ? (opens / sampleSize) * 100 : 0,
						clickRate: sampleSize > 0 ? (clicks / sampleSize) * 100 : 0,
						conversionRate: 0,
					};
				} catch (error) {
					throw new AbTestMetricsUnavailableError(testId, error);
				}
			}),
		);

		return results;
	}

	/**
	 * Cleans up temporary resources created for holdout A/B testing
	 */
	async cleanupHoldoutTest(
		testId: string,
		testLists: number[],
		holdoutListId: number,
		campaigns: number[],
		keepWinnerCampaign: boolean = true,
	): Promise<void> {
		// Delete test lists (but keep holdout list for winner campaign)
		for (const listId of testLists) {
			try {
				await this.listmonkClient.list.delete({
					path: { list_id: listId },
				});
			} catch (error) {
				console.warn(`Failed to delete test list ${listId}:`, error);
			}
		}

		// Optionally delete holdout list (usually kept for winner campaign)
		if (!keepWinnerCampaign) {
			try {
				await this.listmonkClient.list.delete({
					path: { list_id: holdoutListId },
				});
			} catch (error) {
				console.warn(`Failed to delete holdout list ${holdoutListId}:`, error);
			}
		}

		// Tag test campaigns as completed
		for (const campaignId of campaigns) {
			try {
				await this.listmonkClient.campaign.update({
					path: { id: campaignId },
					body: {
						// Note: Tags field may not be available in current API
						// For now, just update the name to indicate completion
						name: `A/B Test Completed - ${testId}`,
					},
				});
			} catch (error) {
				console.warn(`Failed to update campaign ${campaignId}:`, error);
			}
		}
	}

	/**
	 * Legacy cleanup method - kept for backward compatibility
	 * Cleans up temporary resources created for A/B testing
	 */
	async cleanup(
		testId: string,
		temporaryLists: number[],
		campaigns: number[],
	): Promise<void> {
		// Delete temporary lists
		for (const listId of temporaryLists) {
			try {
				await this.listmonkClient.list.delete({
					path: { list_id: listId },
				});
			} catch (error) {
				console.warn(`Failed to delete temporary list ${listId}:`, error);
			}
		}

		// Note: We typically don't delete campaigns as they contain historical data
		// Instead, we could tag them as completed A/B tests
		for (const campaignId of campaigns) {
			try {
				// Update campaign to mark as A/B test completed
				await this.listmonkClient.campaign.update({
					path: { id: campaignId },
					body: {
						// Note: Tags field may not be available in current API
						// For now, just update the name to indicate completion
						name: `A/B Test Legacy Completed - ${testId}`,
					},
				});
			} catch (error) {
				console.warn(`Failed to update campaign ${campaignId}:`, error);
			}
		}
	}

	/**
	 * Launches the A/B test by sending campaigns to segmented audiences
	 */
	async launchTest(
		campaignMappings: { variantId: string; campaignId: number }[],
		listMappings: { variantId: string; listId: number }[],
	): Promise<void> {
		// Apply segmented list mapping and launch each campaign.
		for (const campaign of campaignMappings) {
			const listMapping = listMappings.find(
				(l) => l.variantId === campaign.variantId,
			);

			if (!listMapping) {
				throw new Error(
					`No list mapping found for variant ${campaign.variantId}`,
				);
			}

			const updateResult = await this.listmonkClient.campaign.update({
				path: { id: campaign.campaignId },
				body: {
					lists: [listMapping.listId],
				},
			});
			if ("error" in updateResult) {
				throw new Error(
					`Failed to update campaign ${campaign.campaignId}: ${updateResult.error}`,
				);
			}

			await this.listmonkClient.campaign.updateStatus({
				path: { id: campaign.campaignId },
				body: {
					status: "running",
				},
			});
		}
	}

	/**
	 * Resolved audience members for the given source lists. Backed by the
	 * paginated AudienceResolver, which filters by list_id server-side,
	 * keeps only status==='enabled' subscribers, validates id+uuid presence,
	 * and deduplicates by UUID.
	 *
	 * Note: email is always returned as an empty string. Downstream code
	 * (addSubscriberToList) fetches subscriber details by id from the API,
	 * so the email field here is never consumed. The {id, email} shape is
	 * retained solely for backward compatibility with existing callers of
	 * getAllSubscribers.
	 */
	private async resolveAudience(
		listIds: number[],
	): Promise<{ id: number; email: string }[]> {
		const resolver = createListmonkAudienceResolver(this.listmonkClient);
		await resolver.resolve(listIds);
		const members: readonly AudienceMember[] = resolver.members();
		// Email is not carried by AudienceMember; fetch lazily is unnecessary
		// because the membership path uses subscriber id only. Keep email
		// empty to avoid an extra round trip; callers that need it can read
		// it from the subscriber record directly.
		return members.map((member) => ({
			id: member.subscriberId,
			email: "",
		}));
	}

	async getTotalSubscribers(listIds: number[]): Promise<number> {
		// Delegate to resolveAudience so a caller that first checks the
		// audience size and then fetches the members does not trigger two
		// independent paginated resolutions of the same lists. The
		// deduplicated count is the length of the resolved member list.
		const audience = await this.resolveAudience(listIds);
		return audience.length;
	}

	async getAllSubscribers(
		listIds: number[],
	): Promise<{ id: number; email: string }[]> {
		return this.resolveAudience(listIds);
	}

	async addSubscriberToList(
		subscriberId: number,
		listId: number,
	): Promise<void> {
		const subscriberResult = await this.listmonkClient.subscriber.getById({
			path: { id: subscriberId },
		});
		const subscriber = this.unwrapData(
			subscriberResult,
			`Failed to fetch subscriber ${subscriberId}`,
		);
		const existingListIds = this.extractSubscriberListIds(subscriber.lists);
		if (existingListIds.has(listId)) {
			return;
		}

		const lists = Array.from(new Set([...existingListIds, listId]));
		const body: Record<string, unknown> = { lists };
		if (subscriber.email) {
			body.email = subscriber.email;
		}
		if (subscriber.name) {
			body.name = subscriber.name;
		}
		if (subscriber.status) {
			body.status = subscriber.status;
		}
		if (subscriber.attribs) {
			body.attribs = subscriber.attribs;
		}

		const updateResult = await this.listmonkClient.subscriber.update({
			path: { id: subscriberId },
			body,
		});
		if ("error" in updateResult) {
			throw new Error(
				`Failed to add subscriber ${subscriberId} to list ${listId}: ${updateResult.error}`,
			);
		}
	}

	shuffleArray<T>(array: T[]): T[] {
		const shuffled = [...array];
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			const temp = shuffled[i];
			const swap = shuffled[j];
			if (temp === undefined || swap === undefined) {
				continue;
			}

			shuffled[i] = swap;
			shuffled[j] = temp;
		}
		return shuffled;
	}

	private extractSubscriberListIds(lists: unknown): Set<number> {
		if (!Array.isArray(lists)) {
			return new Set();
		}

		const ids = new Set<number>();
		for (const list of lists) {
			if (typeof list === "number") {
				ids.add(list);
				continue;
			}

			if (
				list &&
				typeof list === "object" &&
				"id" in list &&
				typeof list.id === "number"
			) {
				ids.add(list.id);
			}
		}

		return ids;
	}
}
