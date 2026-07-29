import type { OperationResourceKind } from "./effect";

export type OperationEventSource =
	| "listmonk"
	| "provider"
	| "operation"
	| "abtest"
	| "sequence"
	| "webhook";

export interface OperationEventSpec {
	type: `${string}.${string}`;
	title: string;
	description: string;
	source: OperationEventSource;
	subject: OperationResourceKind;
	schemaVersion: number;
}
