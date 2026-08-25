import { OperationExecutionError } from "@listmonk-ops/operations";
import { getOutput } from "./output";

/**
 * Emit a failed operation's structured recovery handle to stdout before
 * the error propagates. The default uncaught-error rendering collapses the
 * nested details, and operators need the machine-readable echo — for
 * example a failed dispatch's claim set — to build the documented
 * recovery request instead of retrying unbounded work.
 */
export function emitOperationErrorDetails(error: unknown): void {
	if (error instanceof OperationExecutionError && error.details !== undefined) {
		getOutput().json({
			operation: error.operationId,
			error: error.message,
			details: error.details,
		});
	}
}
