import type { OperationId } from "./retry";

/**
 * Experimental specs whose product contract is temporarily bridged from the
 * normalized shared operation boundary. Remove an ID when the operation gains
 * a standalone TypeScript/Typia product-domain contract.
 */
export const runtimeOperationContractIds = [
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
