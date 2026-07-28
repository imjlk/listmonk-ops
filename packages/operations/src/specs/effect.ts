export type OperationResourceKind =
	| "campaign"
	| "subscriber"
	| "message"
	| "audience"
	| "template"
	| "provider"
	| "experiment"
	| "sequence"
	| "spec"
	| "playbook"
	| "control";

export type OperationEffect =
	| ReadEffect
	| WriteEffect
	| DeliveryEffect
	| SuppressionEffect
	| DeleteEffect;

export interface ReadEffect {
	kind: "read";
	resource: OperationResourceKind;
}

export interface WriteEffect {
	kind: "write";
	resource: OperationResourceKind;
	reversible: boolean;
}

export interface DeliveryEffect {
	kind: "delivery";
	resource: Extract<
		OperationResourceKind,
		"campaign" | "message" | "sequence"
	>;
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
	resource: OperationResourceKind;
	reversible: false;
}
