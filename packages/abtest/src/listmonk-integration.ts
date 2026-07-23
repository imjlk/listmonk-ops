import type { ListmonkClient } from "@listmonk-ops/openapi";
import type { AbTest, TestResults, Variant } from "./types";
import {
	allocateByLargestRemainder,
	allocateTestAndHoldout,
} from "./allocation";
import {
	createListmonkAudienceResolver,
	type AudienceMember,
	type AudienceSnapshot,
} from "./audience";
import { AbTestMetricsUnavailableError } from "./metrics";
import {
	buildAssignmentManifest,
	generateAssignmentSeed,
	rankMembers,
	type AssignmentManifest,
} from "./assignment";

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
	 * Segments subscribers for holdout A/B testing using deterministic
	 * SHA-256 assignment. Creates test groups (small %) and holdout group
	 * (large %) via bulk list membership.
	 *
	 * When testId + assignmentSeed are provided, the assignment is fully
	 * reproducible (same seed + audience => same manifest). When omitted, a
	 * fresh seed is generated and returned so the caller can persist it.
	 */
	async segmentSubscribersForHoldout(
		originalLists: number[],
		variants: Variant[],
		testGroupPercentage: number = 10,
		options: {
			testId?: string;
			assignmentSeed?: string;
		} = {},
	): Promise<{
		testListMappings: { variantId: string; listId: number }[];
		holdoutListId: number;
		testGroupSize: number;
		holdoutGroupSize: number;
		assignmentSeed: string;
		audienceSnapshot: AudienceSnapshot;
		assignmentManifest: AssignmentManifest;
	}> {
		const createdListIds: number[] = [];
		let holdoutListId: number | undefined;

		// Resolve the audience once via the paginated AudienceResolver, which
		// paginates by list_id server-side, keeps status=enabled subscribers,
		// validates id+uuid presence, deduplicates by UUID, and computes a
		// deterministic checksum. We use the resolver's members() directly so
		// the assignment manifest and the actual list population share the
		// same UUID-based identity and ranked order.
		const resolver = createListmonkAudienceResolver(this.listmonkClient);
		const resolvedSnapshot = await resolver.resolve(originalLists);
		const resolvedMembers: readonly AudienceMember[] = resolver.members();

		// Build a deterministic assignment manifest from the resolved audience.
		// The same testId + seed + audience always produces the same manifest,
		// so retries and reconciliation never re-split the audience.
		const seed = options.assignmentSeed ?? generateAssignmentSeed();
		const testId = options.testId ?? `abtest-${Date.now()}`;
		const assignmentManifest = buildAssignmentManifest({
			testId,
			seed,
			audience: resolvedSnapshot,
			members: resolvedMembers,
			variants,
			testGroupPercentage,
		});

		// Rank the resolved members in the same deterministic order the
		// manifest used, then slice by each group's expectedCount. This is
		// the critical step: the ranked order — not the resolver's page order
		// — determines which subscribers land in which variant/holdout list.
		const ranked = rankMembers(testId, seed, resolvedMembers);

		const variantGroups = assignmentManifest.groups.filter(
			(group) => group.kind === "variant",
		);
		const holdoutGroup = assignmentManifest.groups.find(
			(group) => group.kind === "holdout",
		);
		const testGroupSize = variantGroups.reduce(
			(sum, group) => sum + group.expectedCount,
			0,
		);
		const holdoutGroupSize = holdoutGroup?.expectedCount ?? 0;

		// Slice the ranked members by the manifest's cumulative boundaries.
		let cursor = 0;
		const variantSubscriberSlices: {
			variantId: string;
			subscriberIds: number[];
		}[] = [];
		for (const group of variantGroups) {
			const slice = ranked.slice(cursor, cursor + group.expectedCount);
			variantSubscriberSlices.push({
				variantId: group.variantId ?? "",
				subscriberIds: slice.map((entry) => entry.member.subscriberId),
			});
			cursor += group.expectedCount;
		}
		const holdoutSubscriberIds = ranked
			.slice(cursor)
			.map((entry) => entry.member.subscriberId);

		// Create holdout list with canonical tags so reconcile can discover
		// it by abtest:<id> + abtest-role:holdout even if local mapping is lost.
		try {
			const holdoutListResult = await this.listmonkClient.list.create({
				body: {
					name: `A/B Test Holdout - ${Date.now()}`,
					type: "private",
					optin: "single",
					description:
						"Holdout group for A/B test - will receive winner variant",
					tags: [`abtest:${testId}`, "abtest-role:holdout"],
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

			// Bulk-add the holdout group (ranked slice) via manageLists chunks.
			await this.addSubscribersToListBulk(holdoutSubscriberIds, holdoutListId);

			const testListMappings: { variantId: string; listId: number }[] = [];

			for (const variantSlice of variantSubscriberSlices) {
				const variant = variants.find((v) => v.id === variantSlice.variantId);
				if (variant === undefined) {
					continue;
				}

				const testListResult = await this.listmonkClient.list.create({
					body: {
						name: `A/B Test - ${variant.name} - ${Date.now()}`,
						type: "private",
						optin: "single",
						description: `Test group for A/B test variant ${variant.name}`,
						tags: [
							`abtest:${testId}`,
							"abtest-role:variant",
							`abtest-variant:${variant.id}`,
						],
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

				// Bulk-add this variant's ranked slice via manageLists chunks.
				await this.addSubscribersToListBulk(
					variantSlice.subscriberIds,
					testListId,
				);

				testListMappings.push({
					variantId: variant.id,
					listId: testListId,
				});
			}

			return {
				testListMappings,
				holdoutListId,
				testGroupSize,
				holdoutGroupSize,
				assignmentSeed: seed,
				audienceSnapshot: resolvedSnapshot,
				assignmentManifest,
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

				// Bulk-add this variant's slice via manageLists chunks.
				await this.addSubscribersToListBulk(
					variantSubscribers.map((subscriber) => subscriber.id),
					listId,
				);

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
	 * Note: email is not carried by AudienceMember, so it is returned as
	 * undefined rather than a misleading empty string. Downstream code uses
	 * subscriber id only; callers that need the email can fetch the
	 * subscriber record by id.
	 */
	private async resolveAudience(
		listIds: number[],
	): Promise<{ id: number; email?: string }[]> {
		const resolver = createListmonkAudienceResolver(this.listmonkClient);
		await resolver.resolve(listIds);
		const members: readonly AudienceMember[] = resolver.members();
		return members.map((member) => ({
			id: member.subscriberId,
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
	): Promise<{ id: number; email?: string }[]> {
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

	/**
	 * Add many subscribers to a single temporary list in chunks via the bulk
	 * manageLists endpoint (PUT /subscribers/lists). This replaces the
	 * per-subscriber GET+UPDATE loop for variant/holdout list population.
	 *
	 * The Listmonk v6.2.0 spike (package README) confirmed that:
	 *   - target_list_ids must be an array ([listId]).
	 *   - re-adding the same chunk is idempotent (no duplicate memberships).
	 * So chunked retries are safe without per-subscriber idempotency records.
	 *
	 * The caller may pass an onProgress callback to checkpoint after each
	 * chunk, so a provisioning retry can resume from the last committed chunk.
	 */
	async addSubscribersToListBulk(
		subscriberIds: number[],
		listId: number,
		options: {
			chunkSize?: number;
			onProgress?: (addedCount: number) => void;
		} = {},
		): Promise<{ addedCount: number }> {
		const chunkSize = options.chunkSize ?? 500;
		if (
				!Number.isFinite(chunkSize) ||
				!Number.isInteger(chunkSize) ||
				chunkSize <= 0
			) {
			throw new Error(
				`chunkSize must be a positive finite integer, received ${chunkSize}`,
			);
		}
		let addedCount = 0;
		for (let offset = 0; offset < subscriberIds.length; offset += chunkSize) {
			const chunk = subscriberIds.slice(offset, offset + chunkSize);
			const result = await this.listmonkClient.subscriber.manageLists({
				body: {
					action: "add",
					ids: chunk,
					target_list_ids: [listId],
				},
			});
			if ("error" in result && result.error !== undefined) {
				throw new Error(
					`Failed to bulk-add subscribers to list ${listId} (chunk at offset ${offset}): ${this.formatError(
						result.error,
					)}`,
				);
			}
			// Verify the response carries a truthy data payload; a malformed
			// response (missing data, or data:false without an error envelope)
			// must not be silently treated as success.
			if (!("data" in result) || result.data !== true) {
				throw new Error(
					`Failed to bulk-add subscribers to list ${listId} (chunk at offset ${offset}): received empty or falsy data`,
				);
			}
			addedCount += chunk.length;
			options.onProgress?.(addedCount);
		}
		return { addedCount };
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
