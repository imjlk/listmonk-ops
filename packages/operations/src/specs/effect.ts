export type OperationResourceKind =
	| "campaign"
	| "subscriber"
	| "message"
	| "audience"
	| "list"
	| "template"
	| "media"
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
	| MaintenanceEffect
	| SuppressionEffect
	| DeleteEffect;

export interface OperationPreviewCapability {
	/**
	 * Whether the operation implements a real no-mutation preview for all
	 * effects declared by the operation. Omit to use the effect-kind default.
	 */
	preview?: boolean | undefined;
}

export interface ReadEffect {
	kind: "read";
	resource: OperationResourceKind;
}

export interface WriteEffect extends OperationPreviewCapability {
	kind: "write";
	resource: OperationResourceKind;
	reversible: boolean;
}

export interface DeliveryEffect extends OperationPreviewCapability {
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
export interface WebhookEffect extends OperationPreviewCapability {
	kind: "webhook";
	resource: "webhook";
	audience: "single" | "bulk";
}

/**
 * Bounded control-plane maintenance. Destructive maintenance requires a
 * preview and confirmation by default; recoverable maintenance also defaults
 * to preview support. Set `preview: false` only when the runtime has no
 * no-mutation execution path.
 */
export type MaintenanceEffect =
	| ({
			kind: "maintenance";
			resource: OperationResourceKind;
			action: "recover";
			destructive: false;
	  } & OperationPreviewCapability)
	| ({
			kind: "maintenance";
			resource: OperationResourceKind;
			action: "prune" | "replay" | "resolve";
			destructive: true;
	  } & OperationPreviewCapability);

export interface SuppressionEffect extends OperationPreviewCapability {
	kind: "suppression";
	resource: "subscriber" | "audience";
	scope: "subscriber" | "audience";
	reversible: boolean;
}

export interface DeleteEffect extends OperationPreviewCapability {
	kind: "delete";
	resource: OperationResourceKind;
	reversible: false;
}
