import type { OperationId } from "./retry";

/**
 * Experimental specs whose product contract is temporarily bridged from the
 * normalized shared operation boundary. Remove an ID when the operation gains
 * a standalone TypeScript/Typia product-domain contract.
 */
export const runtimeOperationContractIds = [
] as const satisfies readonly OperationId[];
