import type { OperationId } from "./retry";

export interface ProductPlaybookStep {
	id: string;
	operation: OperationId;
	approval: "none" | "human";
	description: string;
}

export interface ProductPlaybook {
	id: `${string}.${string}`;
	title: string;
	goal: string;
	steps: readonly [ProductPlaybookStep, ...ProductPlaybookStep[]];
	recoveryOperation: OperationId;
}
