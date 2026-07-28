import type { ProductResourceKind } from "./effect";

export interface ProductEventDefinition {
	type: `${string}.${string}`;
	title: string;
	description: string;
	source:
		| "listmonk"
		| "provider"
		| "operation"
		| "abtest"
		| "sequence";
	subject: ProductResourceKind;
	schemaVersion: number;
}
