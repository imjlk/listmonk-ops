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
	| "control"
	| "operation"
	| "webhook";

export type OperationEffect =
	| ReadEffect
	| WriteEffect
	| DeliveryEffect
	| WebhookEffect
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

/**
 * An outbound HTTP notification. Webhook sends are always confirmation-gated
 * because a retry can cross the local trust boundary even when the underlying
 * event identifier is stable.
 */
export interface WebhookEffect {
	kind: "webhook";
	resource: "webhook";
	audience: "single" | "bulk";
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
