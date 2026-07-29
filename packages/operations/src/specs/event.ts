import type { OperationResourceKind } from "./effect";

export interface OperationEventSpec {
	type: `${string}.${string}`;
	title: string;
	description: string;
	source:
		| "listmonk"
		| "provider"
		| "operation"
		| "abtest"
		| "sequence"
		| "webhook";
	subject: OperationResourceKind;
	schemaVersion: number;
}
