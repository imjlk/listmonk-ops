import { defineOperationResourceSpec } from "./resource";

export const listResource = defineOperationResourceSpec({
	id: "list",
	title: "Subscriber list",
	states: ["active", "deleted"],
	transitions: {
		active: ["deleted"],
		deleted: [],
	},
	terminalStates: ["deleted"],
});

export const templateResource = defineOperationResourceSpec({
	id: "template",
	title: "Email template",
	states: ["active", "default", "deleted"],
	transitions: {
		active: ["default", "deleted"],
		default: ["active", "deleted"],
		deleted: [],
	},
	terminalStates: ["deleted"],
});

export const mediaResource = defineOperationResourceSpec({
	id: "media",
	title: "Media asset",
	states: ["available", "deleted"],
	transitions: {
		available: ["deleted"],
		deleted: [],
	},
	terminalStates: ["deleted"],
});

/**
 * Bounce records are stateless observations produced by Listmonk or an
 * inbound provider event. They never transition on their own; deletion by
 * an operator is the only exit.
 */
/**
 * Server runtime identity and diagnostics. Stateless observations with
 * no lifecycle of their own.
 */
export const bounceResource = defineOperationResourceSpec({
	id: "bounce",
	title: "Bounce record",
	states: ["recorded", "deleted"],
	transitions: {
		recorded: ["deleted"],
		deleted: [],
	},
	terminalStates: ["deleted"],
});

export const systemResource = defineOperationResourceSpec({
	id: "system",
	title: "System runtime",
	states: ["current"],
	transitions: {
		current: [],
	},
	terminalStates: [],
});

/**
 * Dashboard aggregates are computed views over subscriber, list, campaign,
 * and message state. They carry no lifecycle of their own.
 */
export const dashboardResource = defineOperationResourceSpec({
	id: "dashboard",
	title: "Dashboard aggregate",
	states: ["current"],
	transitions: {
		current: [],
	},
	terminalStates: [],
});

/**
 * Installation settings. The shared read returns the document with
 * credential-bearing fields recursively redacted.
 */
export const settingsResource = defineOperationResourceSpec({
	id: "settings",
	title: "Installation settings",
	states: ["current"],
	transitions: {
		current: [],
	},
	terminalStates: [],
});

/**
 * Destructive one-shot garbage collection. The server offers no
 * preview; the shared operations gate on explicit confirmation.
 */
export const maintenanceResource = defineOperationResourceSpec({
	id: "maintenance",
	title: "Maintenance collection",
	states: ["current"],
	transitions: {
		current: [],
	},
	terminalStates: [],
});

export const audienceResource = defineOperationResourceSpec({
	id: "audience",
	title: "Resolved audience",
	states: ["current", "drifted", "suppressed"],
	transitions: {
		current: ["drifted", "suppressed"],
		drifted: ["current", "suppressed"],
		suppressed: ["current"],
	},
	terminalStates: [],
});
