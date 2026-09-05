import { defineOperationSpec } from "../operation";
import {
	subscriberImportStartInputContract,
	subscriberImportStartOutputContract,
	subscriberImportStatusOutputContract,
	subscriberImportStopOutputContract,
	subscriberImportLogsOutputContract,
	subscriberSendOptinInputContract,
	subscriberSendOptinOutputContract,
	subscriberExportInputContract,
	subscriberExportOutputContract,
	emptyInputContract,
	subscriberCreateInputContract,
	subscriberCreateOutputContract,
	subscriberUpdateInputContract,
	subscriberDeleteInputContract,
	subscriberDeleteOutputContract,
	subscriberRecordContract,
	subscriberBulkListsInputContract,
	subscriberBulkBlocklistInputContract,
	subscriberBulkOutputContract,
} from "../contract-schemas";

export const subscribersCreateOperationSpec = defineOperationSpec({
	id: "subscribers.create",
	resource: "subscriber",
	verb: "create",
	title: "Create subscriber",
	description: "Create a subscriber in Listmonk",
	contract: {
		input: subscriberCreateInputContract,
		output: subscriberCreateOutputContract,
	},
	effects: [{ kind: "write", resource: "subscriber", reversible: true }],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: {
		kind: "reconcile",
		reconcileWith: "subscribers.list",
		idempotent: true,
		reason:
			"Subscriber emails are unique, so a retry after an ambiguous create is rejected as already existing and replays the persisted subscriber when every observable create effect matches (email, name, status, list membership across both id and uuid selectors with non-unsubscribed state, canonical attributes), reporting created: false; a conflicting configuration under the same email — an unsubscribed membership, or a request carrying preconfirm_subscriptions whose per-list confirmation effect the request cannot express — stays an explicit error.",
	},
	agent: {
		useWhen: ["A new subscriber must be created."],
		avoidWhen: ["An existing subscriber should be updated instead."],
		prerequisites: [],
		verifyWith: ["subscribers.list"],
		related: ["subscribers.update", "subscribers.delete"],
		retryGuidance:
			"Verify the subscriber with subscribers.list before repeating an ambiguous create; an identical retry replays it with created: false.",
	},
	projection: {
		mcpName: "listmonk_create_subscriber",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#subscribersCreateOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#bindSubscribersCreateOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/subscribers.ts#createSubscriberOperation:variable",
			invokerNode:
				"packages/operations/src/subscribers.ts#invokeCreateSubscriberOperation:function",
			executorNode:
				"packages/operations/src/subscribers.ts#createSubscriber:function",
		},
	},
	stability: "stable",
	since: "0.9.0",
});

export const subscribersUpdateOperationSpec = defineOperationSpec({
	id: "subscribers.update",
	resource: "subscriber",
	verb: "update",
	title: "Update subscriber",
	description: "Update a subscriber in Listmonk",
	contract: {
		input: subscriberUpdateInputContract,
		output: subscriberRecordContract,
	},
	effects: [{ kind: "write", resource: "subscriber", reversible: true }],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: {
		kind: "safe",
		reason:
			"Reapplying the same requested subscriber fields converges on the same representation.",
	},
	agent: {
		useWhen: ["A known subscriber must be updated by numeric ID."],
		avoidWhen: ["The subscriber ID is unknown."],
		prerequisites: ["subscribers.get"],
		verifyWith: ["subscribers.get"],
		related: ["subscribers.delete"],
		retryGuidance:
			"Retry identical transient failures with bounded backoff, then verify with subscribers.get.",
	},
	projection: {
		mcpName: "listmonk_update_subscriber",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#subscribersUpdateOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#bindSubscribersUpdateOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/subscribers.ts#updateSubscriberOperation:variable",
			invokerNode:
				"packages/operations/src/subscribers.ts#invokeUpdateSubscriberOperation:function",
			executorNode:
				"packages/operations/src/subscribers.ts#updateSubscriber:function",
		},
	},
	stability: "stable",
	since: "0.9.0",
});

export const subscribersDeleteOperationSpec = defineOperationSpec({
	id: "subscribers.delete",
	resource: "subscriber",
	verb: "delete",
	title: "Delete subscriber",
	description: "Delete a subscriber from Listmonk",
	contract: {
		input: subscriberDeleteInputContract,
		output: subscriberDeleteOutputContract,
	},
	effects: [{ kind: "delete", resource: "subscriber", reversible: false }],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "reconcile",
		reconcileWith: "subscribers.list",
		idempotent: true,
		reason:
			"Deleting an already-deleted subscriber is a no-op; verify with subscribers.list after an ambiguous result.",
	},
	agent: {
		useWhen: ["A subscriber must be permanently removed."],
		avoidWhen: ["The subscriber should be blocklisted instead."],
		prerequisites: ["subscribers.get"],
		verifyWith: ["subscribers.list"],
		related: ["subscribers.update"],
		retryGuidance:
			"Verify the subscriber is gone with subscribers.list before retrying.",
	},
	projection: {
		mcpName: "listmonk_delete_subscriber",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#subscribersDeleteOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#bindSubscribersDeleteOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/subscribers.ts#deleteSubscriberOperation:variable",
			invokerNode:
				"packages/operations/src/subscribers.ts#invokeDeleteSubscriberOperation:function",
			executorNode:
				"packages/operations/src/subscribers.ts#deleteSubscriber:function",
		},
	},
	stability: "stable",
	since: "0.9.0",
});

export const subscribersAddToListsOperationSpec = defineOperationSpec({
	id: "subscribers.add-to-lists",
	resource: "subscriber",
	verb: "add-to-lists",
	title: "Add subscribers to lists",
	description:
		"Add a batch of subscribers to one or more lists. Processes subscribers in chunks and supports dry-run, max-items cap, and continue-on-error.",
	contract: {
		input: subscriberBulkListsInputContract,
		output: subscriberBulkOutputContract,
	},
	effects: [
		{
			kind: "write",
			resource: "subscriber",
			reversible: true,
			preview: true,
		},
	],
	policy: { confirmation: "never", audit: "required", dryRun: true },
	retry: {
		kind: "safe",
		reason:
			"Reapplying the same add-to-lists action converges on the same membership state.",
	},
	agent: {
		useWhen: ["Subscribers must be added to one or more lists in bulk."],
		avoidWhen: ["The subscribers or lists are not known."],
		prerequisites: ["subscribers.get", "lists.get"],
		verifyWith: ["subscribers.get"],
		related: ["subscribers.remove-from-lists"],
		retryGuidance: "Retry identical transient failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_add_subscribers_to_lists",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#subscribersAddToListsOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#bindSubscribersAddToListsOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/subscribers.ts#addSubscribersToListsOperation:variable",
			invokerNode:
				"packages/operations/src/subscribers.ts#invokeAddSubscribersToListsOperation:function",
			executorNode:
				"packages/operations/src/subscribers.ts#addSubscribersToLists:function",
		},
	},
	stability: "stable",
	since: "0.9.0",
});

export const subscribersRemoveFromListsOperationSpec = defineOperationSpec({
	id: "subscribers.remove-from-lists",
	resource: "subscriber",
	verb: "remove-from-lists",
	title: "Remove subscribers from lists",
	description:
		"Remove a batch of subscribers from one or more lists. Processes subscribers in chunks and supports dry-run, max-items cap, and continue-on-error. Destructive because re-adding subscribers does not guarantee their previous per-list subscription state is reconstructed.",
	contract: {
		input: subscriberBulkListsInputContract,
		output: subscriberBulkOutputContract,
	},
	effects: [
		{
			kind: "write",
			resource: "subscriber",
			reversible: false,
			preview: true,
		},
	],
	policy: { confirmation: "required", audit: "required", dryRun: true },
	retry: {
		kind: "safe",
		reason:
			"Reapplying the same remove-from-lists action converges on the same membership state.",
	},
	agent: {
		useWhen: ["Subscribers must be removed from one or more lists in bulk."],
		avoidWhen: ["The subscribers or lists are not known."],
		prerequisites: ["subscribers.get", "lists.get"],
		verifyWith: ["subscribers.get"],
		related: ["subscribers.add-to-lists"],
		retryGuidance: "Retry identical transient failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_remove_subscribers_from_lists",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#subscribersRemoveFromListsOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#bindSubscribersRemoveFromListsOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/subscribers.ts#removeSubscribersFromListsOperation:variable",
			invokerNode:
				"packages/operations/src/subscribers.ts#invokeRemoveSubscribersFromListsOperation:function",
			executorNode:
				"packages/operations/src/subscribers.ts#removeSubscribersFromLists:function",
		},
	},
	stability: "stable",
	since: "0.9.0",
});

export const subscribersUnblocklistOperationSpec = defineOperationSpec({
	id: "subscribers.unblocklist",
	resource: "subscriber",
	verb: "unblocklist",
	title: "Unblocklist subscribers",
	description:
		"Remove a batch of subscribers from the blocklist. Processes subscribers in chunks and supports dry-run, max-items cap, and continue-on-error.",
	contract: {
		input: subscriberBulkBlocklistInputContract,
		output: subscriberBulkOutputContract,
	},
	effects: [
		{
			kind: "write",
			resource: "subscriber",
			reversible: true,
			preview: true,
		},
	],
	policy: { confirmation: "never", audit: "required", dryRun: true },
	retry: {
		kind: "safe",
		reason:
			"Reapplying the same unblocklist action converges on the same state.",
	},
	agent: {
		useWhen: ["Subscribers must be removed from the blocklist in bulk."],
		avoidWhen: ["The subscriber IDs are not known."],
		prerequisites: ["subscribers.get"],
		verifyWith: ["subscribers.get"],
		related: ["subscribers.blocklist"],
		retryGuidance: "Retry identical transient failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_unblocklist_subscribers",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#subscribersUnblocklistOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#bindSubscribersUnblocklistOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/subscribers.ts#unblocklistSubscribersOperation:variable",
			invokerNode:
				"packages/operations/src/subscribers.ts#invokeUnblocklistSubscribersOperation:function",
			executorNode:
				"packages/operations/src/subscribers.ts#unblocklistSubscribers:function",
		},
	},
	stability: "stable",
	since: "0.9.0",
});

export function bindSubscribersCreateOperationSpec(): typeof subscribersCreateOperationSpec {
	return subscribersCreateOperationSpec;
}

export function bindSubscribersUpdateOperationSpec(): typeof subscribersUpdateOperationSpec {
	return subscribersUpdateOperationSpec;
}

export function bindSubscribersDeleteOperationSpec(): typeof subscribersDeleteOperationSpec {
	return subscribersDeleteOperationSpec;
}

export function bindSubscribersAddToListsOperationSpec(): typeof subscribersAddToListsOperationSpec {
	return subscribersAddToListsOperationSpec;
}

export function bindSubscribersRemoveFromListsOperationSpec(): typeof subscribersRemoveFromListsOperationSpec {
	return subscribersRemoveFromListsOperationSpec;
}

export const subscribersImportStartOperationSpec = defineOperationSpec({
	id: "subscribers.import.start",
	resource: "subscriber",
	verb: "start",
	title: "Start a subscriber CSV import",
	description:
		"Upload a CSV and start an asynchronous subscriber import. The importer upserts rows by email, so a repeated identical import converges; poll subscribers.import.status for progress.",
	contract: {
		input: subscriberImportStartInputContract,
		output: subscriberImportStartOutputContract,
	},
	effects: [{ kind: "write", resource: "subscriber", reversible: false }],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "conditional",
		cases: [
			{
				when: "the identical CSV is re-imported",
				semantics: {
					kind: "safe",
					reason:
						"Listmonk upserts imported rows by email, so repeating an identical CSV converges on the same subscribers; blocklist mode is likewise idempotent per email.",
				},
			},
			{
				when: "the CSV changed between attempts",
				semantics: {
					kind: "unsafe",
					reason:
						"A different CSV under the same intent imports different rows with no key to correlate the attempts.",
				},
			},
		],
		reason: "Retry safety depends on the CSV being unchanged between attempts.",
	},
	agent: {
		useWhen: ["A batch of subscribers must be imported from CSV."],
		avoidWhen: ["A single subscriber suffices — prefer subscribers.create."],
		prerequisites: ["lists.list"],
		verifyWith: ["subscribers.import.status"],
		related: ["subscribers.import.status", "subscribers.import.stop"],
		retryGuidance:
			"Re-issue the identical CSV only after checking subscribers.import.status; the importer upserts by email so a repeat converges.",
	},
	projection: {
		mcpName: "listmonk_start_subscriber_import",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#subscribersImportStartOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#bindSubscribersImportStartOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/subscribers.ts#startSubscriberImportOperation:variable",
			invokerNode:
				"packages/operations/src/subscribers.ts#invokeStartSubscriberImportOperation:function",
			executorNode:
				"packages/operations/src/subscribers.ts#startSubscriberImport:function",
		},
	},
	stability: "stable",
	since: "0.17.0",
});

export const subscribersImportStatusOperationSpec = defineOperationSpec({
	id: "subscribers.import.status",
	resource: "subscriber",
	verb: "status",
	title: "Read subscriber import status",
	description:
		"Read the current asynchronous subscriber-import session status, including progress counters.",
	contract: {
		input: emptyInputContract,
		output: subscriberImportStatusOutputContract,
	},
	effects: [{ kind: "read", resource: "subscriber" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason: "The operation only reads the current import session state.",
	},
	agent: {
		useWhen: ["An import's progress or completion must be checked."],
		avoidWhen: ["No import session has been started."],
		prerequisites: ["subscribers.import.start"],
		verifyWith: [],
		related: ["subscribers.import.start", "subscribers.import.stop"],
		retryGuidance: "Retry transient read failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_get_subscriber_import_status",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#subscribersImportStatusOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#bindSubscribersImportStatusOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/subscribers.ts#getSubscriberImportStatusOperation:variable",
			invokerNode:
				"packages/operations/src/subscribers.ts#invokeGetSubscriberImportStatusOperation:function",
			executorNode:
				"packages/operations/src/subscribers.ts#readSubscriberImportStatus:function",
		},
	},
	stability: "stable",
	since: "0.17.0",
});

export const subscribersImportStopOperationSpec = defineOperationSpec({
	id: "subscribers.import.stop",
	resource: "subscriber",
	verb: "stop",
	title: "Stop the subscriber import",
	description:
		"Send the stop signal to the running subscriber importer and read the reset session status.",
	contract: {
		input: emptyInputContract,
		output: subscriberImportStopOutputContract,
	},
	effects: [{ kind: "write", resource: "subscriber", reversible: true }],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: {
		kind: "safe",
		reason:
			"The stop signal resets the session; repeating it against an idle importer returns the same reset status.",
	},
	agent: {
		useWhen: ["A running import must be cancelled."],
		avoidWhen: ["No import session is running."],
		prerequisites: ["subscribers.import.status"],
		verifyWith: ["subscribers.import.status"],
		related: ["subscribers.import.start"],
		retryGuidance:
			"Repeat safely — an already-stopped importer answers with the same idle status.",
	},
	projection: {
		mcpName: "listmonk_stop_subscriber_import",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#subscribersImportStopOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#bindSubscribersImportStopOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/subscribers.ts#stopSubscriberImportOperation:variable",
			invokerNode:
				"packages/operations/src/subscribers.ts#invokeStopSubscriberImportOperation:function",
			executorNode:
				"packages/operations/src/subscribers.ts#stopSubscriberImport:function",
		},
	},
	stability: "stable",
	since: "0.17.0",
});

export function bindSubscribersImportStartOperationSpec(): typeof subscribersImportStartOperationSpec {
	return subscribersImportStartOperationSpec;
}

export function bindSubscribersImportStatusOperationSpec(): typeof subscribersImportStatusOperationSpec {
	return subscribersImportStatusOperationSpec;
}

export function bindSubscribersImportStopOperationSpec(): typeof subscribersImportStopOperationSpec {
	return subscribersImportStopOperationSpec;
}

export const subscribersImportLogsOperationSpec = defineOperationSpec({
	id: "subscribers.import.logs",
	resource: "subscriber",
	verb: "logs",
	title: "Read subscriber import logs",
	description:
		"Read the raw importer log lines from the most recent subscriber-import session.",
	contract: {
		input: emptyInputContract,
		output: subscriberImportLogsOutputContract,
	},
	effects: [{ kind: "read", resource: "subscriber" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason: "The operation only reads recorded importer log lines.",
	},
	agent: {
		useWhen: [
			"An import's raw log output must be inspected, typically after a finished or stopped session.",
		],
		avoidWhen: ["Only progress counters are needed — prefer subscribers.import.status."],
		prerequisites: ["subscribers.import.status"],
		verifyWith: [],
		related: [
			"subscribers.import.start",
			"subscribers.import.status",
			"subscribers.import.stop",
		],
		retryGuidance: "Retry transient read failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_get_subscriber_import_logs",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#subscribersImportLogsOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#bindSubscribersImportLogsOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/subscribers.ts#getSubscriberImportLogsOperation:variable",
			invokerNode:
				"packages/operations/src/subscribers.ts#invokeGetSubscriberImportLogsOperation:function",
			executorNode:
				"packages/operations/src/subscribers.ts#readSubscriberImportLogs:function",
		},
	},
	stability: "stable",
	since: "0.17.0",
});

export function bindSubscribersImportLogsOperationSpec(): typeof subscribersImportLogsOperationSpec {
	return subscribersImportLogsOperationSpec;
}

/**
 * The full data-portability bundle for one subscriber. It is a
 * comprehensive PII read — profile, subscriptions, and engagement
 * history — so agent guidance points at subscribers.get for everything
 * short of an explicit export request.
 */
export const subscribersExportOperationSpec = defineOperationSpec({
	id: "subscribers.export",
	resource: "subscriber",
	verb: "export",
	title: "Export subscriber data",
	description:
		"Read the complete data-portability export for one subscriber: profile, list subscriptions, campaign views, and link clicks.",
	contract: {
		input: subscriberExportInputContract,
		output: subscriberExportOutputContract,
	},
	effects: [{ kind: "read", resource: "subscriber" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason: "The operation only reads the subscriber's recorded data.",
	},
	agent: {
		useWhen: [
			"A subscriber explicitly requested their data export and the complete bundle is required.",
		],
		avoidWhen: [
			"Only the profile is needed — prefer subscribers.get; the export carries the full engagement history.",
		],
		prerequisites: ["subscribers.get"],
		verifyWith: [],
		related: ["subscribers.get", "subscribers.list"],
		retryGuidance: "Retry transient read failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_export_subscriber",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#subscribersExportOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#bindSubscribersExportOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/subscribers.ts#exportSubscriberOperation:variable",
			invokerNode:
				"packages/operations/src/subscribers.ts#invokeExportSubscriberOperation:function",
			executorNode:
				"packages/operations/src/subscribers.ts#exportSubscriber:function",
		},
	},
	stability: "stable",
	since: "0.17.0",
});

export function bindSubscribersExportOperationSpec(): typeof subscribersExportOperationSpec {
	return subscribersExportOperationSpec;
}

export const subscribersSendOptinOperationSpec = defineOperationSpec({
	id: "subscribers.send-optin",
	resource: "subscriber",
	verb: "send-optin",
	title: "Resend the double opt-in email",
	description:
		"Resend the double opt-in confirmation email to one subscriber. Every run sends a real message.",
	contract: {
		input: subscriberSendOptinInputContract,
		output: subscriberSendOptinOutputContract,
	},
	effects: [
		{
			kind: "delivery",
			resource: "message",
			audience: "single",
			timing: "immediate",
		},
	],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: {
		kind: "unsafe",
		reason:
			"Every run dispatches a fresh opt-in message; Listmonk offers no idempotency key for the resend. A single, explicitly chosen recipient keeps the transactional-send convention of no destructive confirmation.",
	},
	agent: {
		useWhen: [
			"A subscriber requested the double opt-in confirmation email again.",
		],
		avoidWhen: [
			"The subscriber never consented — an opt-in email is still a delivery.",
		],
		prerequisites: ["subscribers.get"],
		verifyWith: [],
		related: ["subscribers.get", "transactional.send"],
		retryGuidance:
			"Do not blindly repeat: each confirmed request re-sends the message. Verify the inbox before retrying.",
	},
	projection: {
		mcpName: "listmonk_send_optin",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#subscribersSendOptinOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#bindSubscribersSendOptinOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/subscribers.ts#sendOptinOperation:variable",
			invokerNode:
				"packages/operations/src/subscribers.ts#invokeSendOptinOperation:function",
			executorNode:
				"packages/operations/src/subscribers.ts#sendSubscriberOptin:function",
		},
	},
	stability: "stable",
	since: "0.17.0",
});

export function bindSubscribersSendOptinOperationSpec(): typeof subscribersSendOptinOperationSpec {
	return subscribersSendOptinOperationSpec;
}

export function bindSubscribersUnblocklistOperationSpec(): typeof subscribersUnblocklistOperationSpec {
	return subscribersUnblocklistOperationSpec;
}
