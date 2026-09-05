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
export const systemResource = defineOperationResourceSpec({
	id: "system",
	title: "System runtime",
	states: ["current"],
	transitions: {
		current: [],
	},
	terminalStates: [],
});

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
