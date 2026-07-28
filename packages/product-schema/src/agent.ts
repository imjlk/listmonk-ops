import type { OperationId } from "./retry";

export interface AgentOperationContext {
	useWhen: readonly [string, ...string[]];
	avoidWhen: readonly [string, ...string[]];
	/**
	 * Runtime operation catalog IDs that should run first. During incremental
	 * migration these references may target existing operations that do not yet
	 * have Product Schema descriptors.
	 */
	prerequisites: readonly OperationId[];
	/** Runtime operation catalog IDs used to verify the result. */
	verifyWith: readonly OperationId[];
	/** Related runtime operation catalog IDs offered for planning context. */
	related: readonly OperationId[];
	retryGuidance: string;
}
