import type { ListmonkClient } from "@listmonk-ops/openapi";
import type { AbTest, TestResults, Variant } from "./types";

/**
 * Listmonk integration for A/B testing
 * Handles actual campaign creation, subscriber segmentation, and result collection
 */
export class ListmonkAbTestIntegration {
	constructor(private listmonkClient: ListmonkClient) {}

	private requireNumericId(value: unknown, context: string): number {
		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}

		throw new Error(`${context}: response missing numeric id`);
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

		for (const variant of abTest.variants) {
			// Create campaign for this variant
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

			if ("error" in result) {
				throw new Error(
					`Failed to create campaign for variant ${variant.name}: ${result.error}`,
				);
			}

			createdCampaigns.push({
				variantId: variant.id,
				campaignId: this.requireNumericId(
					result.data.id,
					`Failed to create campaign for variant ${variant.name}`,
				),
			});
		}

		return createdCampaigns;
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
		// Get all subscribers from original lists
		const allSubscribers = await this.getAllSubscribers(originalLists);
		const totalSubscribers = allSubscribers.length;

		// Calculate group sizes
		const testGroupSize = Math.floor(
			(totalSubscribers * testGroupPercentage) / 100,
		);
		const holdoutGroupSize = totalSubscribers - testGroupSize;

		// Shuffle subscribers for random distribution
		const shuffledSubscribers = this.shuffleArray([...allSubscribers]);

		// Split into test group and holdout group
		const testGroupSubscribers = shuffledSubscribers.slice(0, testGroupSize);
		const holdoutGroupSubscribers = shuffledSubscribers.slice(testGroupSize);

		// Create holdout list
		const holdoutListResult = await this.listmonkClient.list.create({
			body: {
				name: `A/B Test Holdout - ${Date.now()}`,
				type: "private",
				optin: "single",
				description: "Holdout group for A/B test - will receive winner variant",
			},
		});

		if ("error" in holdoutListResult) {
			throw new Error(
				`Failed to create holdout list: ${holdoutListResult.error}`,
			);
		}

		const holdoutListId = this.requireNumericId(
			holdoutListResult.data.id,
			"Failed to create holdout list",
		);

		// Add holdout subscribers to holdout list
		for (const subscriber of holdoutGroupSubscribers) {
			await this.addSubscriberToList(subscriber.id, holdoutListId);
		}

		// Create test lists for each variant
		const testListMappings: { variantId: string; listId: number }[] = [];
		const testGroupPerVariant = Math.floor(testGroupSize / variants.length);

		let currentIndex = 0;
		for (const variant of variants) {
			// Get subscribers for this variant
			const variantSubscribers = testGroupSubscribers.slice(
				currentIndex,
				currentIndex + testGroupPerVariant,
			);

			// Create test list for this variant
			const testListResult = await this.listmonkClient.list.create({
				body: {
					name: `A/B Test - ${variant.name} - ${Date.now()}`,
					type: "private",
					optin: "single",
					description: `Test group for A/B test variant ${variant.name}`,
				},
			});

			if ("error" in testListResult) {
				throw new Error(
					`Failed to create test list for variant ${variant.name}: ${testListResult.error}`,
				);
			}

			const testListId = this.requireNumericId(
				testListResult.data.id,
				`Failed to create test list for variant ${variant.name}`,
			);

			// Add subscribers to test list
			for (const subscriber of variantSubscribers) {
				await this.addSubscriberToList(subscriber.id, testListId);
			}

			testListMappings.push({
				variantId: variant.id,
				listId: testListId,
			});

			currentIndex += testGroupPerVariant;
		}

		return {
			testListMappings,
			holdoutListId,
			testGroupSize,
			holdoutGroupSize,
		};
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

		// Get all subscribers from original lists
		const allSubscribers = await this.getAllSubscribers(originalLists);

		// Shuffle subscribers for random distribution
		const shuffledSubscribers = this.shuffleArray([...allSubscribers]);

		let currentIndex = 0;
		for (const variant of variants) {
			// Calculate subscriber count for this variant
			const variantCount = Math.floor(
				(shuffledSubscribers.length * variant.percentage) / 100,
			);

			// Get subscribers for this variant
			const variantSubscribers = shuffledSubscribers.slice(
				currentIndex,
				currentIndex + variantCount,
			);

			// Create temporary list for this variant
			const listResult = await this.listmonkClient.list.create({
				body: {
					name: `A/B Test - ${variant.name} - ${Date.now()}`,
					type: "private",
					optin: "single",
					description: `Temporary list for A/B test variant ${variant.name}`,
				},
			});

			if ("error" in listResult) {
				throw new Error(
					`Failed to create list for variant ${variant.name}: ${listResult.error}`,
				);
			}

			const listId = this.requireNumericId(
				listResult.data.id,
				`Failed to create list for variant ${variant.name}`,
			);

			// Add subscribers to this list
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

		if ("error" in result) {
			throw new Error(`Failed to create winner campaign: ${result.error}`);
		}

		return this.requireNumericId(
			result.data.id,
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
		_testId: string,
		campaignMappings: { variantId: string; campaignId: number }[],
	): Promise<TestResults[]> {
		const results: TestResults[] = [];

		for (const mapping of campaignMappings) {
			const campaignResult = await this.listmonkClient.campaign.getById({
				path: { id: mapping.campaignId },
			});

			if ("error" in campaignResult) {
				throw new Error(
					`Failed to get campaign ${mapping.campaignId}: ${campaignResult.error}`,
				);
			}

			const campaign = campaignResult.data;

			// Calculate metrics from campaign data
			const sampleSize = campaign.sent || 0;
			const opens = campaign.views || 0;
			const clicks = campaign.clicks || 0;

			// For conversion tracking, we'd need additional integration
			// For now, use click-through as a proxy for conversions
			const conversions = clicks;

			const openRate = sampleSize > 0 ? (opens / sampleSize) * 100 : 0;
			const clickRate = sampleSize > 0 ? (clicks / sampleSize) * 100 : 0;
			const conversionRate =
				sampleSize > 0 ? (conversions / sampleSize) * 100 : 0;

			results.push({
				variantId: mapping.variantId,
				sampleSize,
				opens,
				clicks,
				conversions,
				openRate,
				clickRate,
				conversionRate,
			});
		}

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

	async getTotalSubscribers(listIds: number[]): Promise<number> {
		let total = 0;
		for (const listId of listIds) {
			const listResult = await this.listmonkClient.list.getById({
				path: { list_id: listId },
			});

			if ("error" in listResult) {
				throw new Error(`Failed to get list ${listId}: ${listResult.error}`);
			}

			total += Math.max(0, Number(listResult.data.subscriber_count ?? 0));
		}

		// Some Listmonk setups can return stale/zero subscriber_count for API users.
		// Fall back to direct subscriber enumeration to avoid false validation failures.
		if (total === 0) {
			const subscribers = await this.getAllSubscribers(listIds);
			return subscribers.length;
		}

		return total;
	}

	async getAllSubscribers(
		listIds: number[],
	): Promise<{ id: number; email: string }[]> {
		const subscribersById = new Map<number, { id: number; email: string }>();
		const targetListIds = new Set(listIds);

		// Get subscribers from all lists
		const subscribersResult = await this.listmonkClient.subscriber.list({
			query: {
				per_page: "all",
				// Note: lists parameter might need to be handled differently
				// For now, we'll get all subscribers and filter later
			},
		});

		if ("error" in subscribersResult) {
			throw new Error(`Failed to get subscribers: ${subscribersResult.error}`);
		}

		for (const subscriber of subscribersResult.data.results) {
			const subscriberId = subscriber.id;
			const subscriberEmail = subscriber.email;
			if (!subscriberId || !subscriberEmail) {
				continue;
			}

			if (targetListIds.size > 0) {
				const subscriberListIds = this.extractSubscriberListIds(
					subscriber.lists,
				);
				if (
					subscriberListIds.size > 0 &&
					![...subscriberListIds].some((listId) => targetListIds.has(listId))
				) {
					continue;
				}
			}

			subscribersById.set(subscriberId, {
				id: subscriberId,
				email: subscriberEmail,
			});
		}

		return Array.from(subscribersById.values());
	}

	async addSubscriberToList(
		subscriberId: number,
		listId: number,
	): Promise<void> {
		const subscriberResult = await this.listmonkClient.subscriber.getById({
			path: { id: subscriberId },
		});
		if ("error" in subscriberResult) {
			throw new Error(
				`Failed to fetch subscriber ${subscriberId}: ${subscriberResult.error}`,
			);
		}

		const subscriber = subscriberResult.data;
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
