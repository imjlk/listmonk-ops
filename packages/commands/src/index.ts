// Export base classes and interfaces

// Export all command classes and factories
export * from "./abtest";
export { BaseCommand, type Command } from "./base";
export * from "./campaigns";
export * from "./lists";
export type { ListmonkClient } from "./types";

// Legacy unified factory for backward compatibility
import type { AbTestService } from "@listmonk-ops/abtest";
import { createAbTestExecutors } from "./abtest";
import { createCampaignExecutors } from "./campaigns";
import { createListExecutors } from "./lists";
import type { ListmonkClient } from "./types";

/**
 * @deprecated Use specific command executors instead:
 * - createAbTestExecutors()
 * - createCampaignExecutors()
 * - createListExecutors()
 */
export function createCommandExecutors(
	abTestService: AbTestService,
	listmonkClient: ListmonkClient,
) {
	const abTestExecutors = createAbTestExecutors(abTestService);
	const campaignExecutors = createCampaignExecutors(listmonkClient);
	const listExecutors = createListExecutors(listmonkClient);

	return {
		...abTestExecutors,
		...campaignExecutors,
		...listExecutors,
	};
}
