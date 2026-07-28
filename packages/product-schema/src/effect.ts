export type ProductResourceKind =
	| "campaign"
	| "subscriber"
	| "audience"
	| "template"
	| "provider"
	| "experiment"
	| "sequence";

export type OperationEffect =
	| ReadEffect
	| WriteEffect
	| DeliveryEffect
	| SuppressionEffect
	| DeleteEffect;

export interface ReadEffect {
	kind: "read";
	resource: ProductResourceKind;
}

export interface WriteEffect {
	kind: "write";
	resource: ProductResourceKind;
	reversible: boolean;
}

export interface DeliveryEffect {
	kind: "delivery";
	resource: "campaign" | "sequence";
	audience: "single" | "bulk";
	timing: "immediate" | "scheduled";
}

export interface SuppressionEffect {
	kind: "suppression";
	resource: "subscriber" | "audience";
	scope: "subscriber" | "audience";
	reversible: boolean;
}

export interface DeleteEffect {
	kind: "delete";
	resource: ProductResourceKind;
	reversible: false;
}
