import type { OperationId } from "./retry";

/**
 * Experimental specs whose product contract is temporarily bridged from the
 * normalized shared operation boundary. Remove an ID when the operation gains
 * a standalone TypeScript/Typia product-domain contract.
 */
export const runtimeOperationContractIds = [
	"lists.create",
	"lists.update",
	"lists.delete",
	"subscribers.create",
	"subscribers.update",
	"subscribers.delete",
	"subscribers.add-to-lists",
	"subscribers.remove-from-lists",
	"subscribers.unblocklist",
	"campaigns.create",
	"campaigns.update",
	"campaigns.delete",
	"campaigns.pause",
	"campaigns.clone",
	"media.delete",
	"media.upload",
	"ops.campaign.deliverability-guard",
	"ops.subscribers.hygiene",
	"ops.segments.drift",
	"ops.templates.registry-sync",
	"ops.templates.registry-history",
	"ops.templates.registry-promote",
	"ops.templates.registry-rollback",
	"ops.digest.daily",
	"abtest.list",
	"abtest.get",
	"abtest.create",
	"abtest.analyze",
	"abtest.launch",
	"abtest.stop",
	"abtest.delete",
	"abtest.recommend-sample-size",
	"abtest.deploy-winner",
	"abtest.run",
	"abtest.tick",
	"abtest.reconcile",
	"abtest.export-assignment",
] as const satisfies readonly OperationId[];
