import generatedRuntimeContracts from "./generated/runtime-operation-contracts.json" with {
	type: "json",
};
import type { NormalizedContractSchema } from "./json";
import type { OperationId } from "./retry";

export interface RuntimeOperationContract {
	input: NormalizedContractSchema;
	output: NormalizedContractSchema;
}

const runtimeContracts =
	generatedRuntimeContracts as unknown as Readonly<
		Record<OperationId, RuntimeOperationContract>
	>;

/**
 * Return the committed normalized contract at the shared operation boundary.
 *
 * This is intentionally not a Listmonk OpenAPI contract. It snapshots the
 * input and output already normalized by listmonk-ops so experimental product
 * specs can be complete without importing endpoint-shaped generated SDK types.
 */
export function runtimeOperationContract(
	operationId: OperationId,
): RuntimeOperationContract {
	const contract = runtimeContracts[operationId];
	if (contract === undefined) {
		throw new TypeError(
			`Missing generated runtime contract for ${operationId}`,
		);
	}
	return contract;
}
