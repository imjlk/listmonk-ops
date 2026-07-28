import type { OperationId } from "./retry";

export interface OperationPlaybookStep {
	id: string;
	operation: OperationId;
	approval: "none" | "human";
	description: string;
}

export interface OperationPlaybook {
	id: `${string}.${string}`;
	title: string;
	goal: string;
	steps: readonly [OperationPlaybookStep, ...OperationPlaybookStep[]];
	recoveryOperation: OperationId;
}
