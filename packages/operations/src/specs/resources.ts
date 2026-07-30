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
