import type { AgentOperationContext } from "./agent";
import type { OperationEffect, OperationResourceKind } from "./effect";
import {
	defineOperationSpec,
	type AnyOperationSpec,
	type OperationSpec,
	type OperationSpecVerb,
	type OperationStateTransitionSpec,
} from "./operation";
import { expectedPolicyForEffects } from "./policy";
import type { OperationId, RetrySemantics } from "./retry";
import { runtimeOperationContract } from "./runtime-contracts";
import type {
	runtimeOperationContractIds,
} from "./runtime-contract-ids";

type BridgedOperationId = (typeof runtimeOperationContractIds)[number];

interface BridgedOperationDeclaration {
	id: BridgedOperationId;
	resource: OperationResourceKind;
	verb: OperationSpecVerb;
	title: string;
	description: string;
	mcpName: `listmonk_${string}`;
	effects: readonly OperationEffect[];
	idempotent: boolean;
	runtimeFile: string;
	runtimeDefinition: string;
	invoker: string;
	executor: string;
	prerequisites?: readonly OperationId[];
	verifyWith?: readonly OperationId[];
	related?: readonly OperationId[];
	state?: OperationStateTransitionSpec;
}

const read = (resource: OperationResourceKind): readonly OperationEffect[] => [
	{ kind: "read", resource },
];
const write = (
	resource: OperationResourceKind,
	reversible: boolean,
	preview?: boolean,
): readonly OperationEffect[] => [
	{
		kind: "write",
		resource,
		reversible,
		...(preview === undefined ? {} : { preview }),
	},
];
const remove = (resource: OperationResourceKind): readonly OperationEffect[] => [
	{ kind: "delete", resource, reversible: false },
];

function retrySemantics(
	declaration: BridgedOperationDeclaration,
): RetrySemantics {
	return declaration.idempotent
		? {
				kind: "safe",
				reason:
					"The shared operation contract declares identical retries idempotent.",
			}
		: {
				kind: "unsafe",
				reason:
					"The shared operation may create, deliver, or advance state before an ambiguous failure.",
			};
}

function agentContext(
	declaration: BridgedOperationDeclaration,
): AgentOperationContext {
	const readOnly = declaration.effects.every(
		(effect) => effect.kind === "read",
	);
	return {
		useWhen: [declaration.description],
		avoidWhen: [
			readOnly
				? "A mutation or workflow transition is required instead of inspection."
				: "The target, intended side effect, or required confirmation has not been verified.",
		],
		prerequisites: declaration.prerequisites ?? [],
		verifyWith: declaration.verifyWith ?? [],
		related: declaration.related ?? [],
		retryGuidance: declaration.idempotent
			? "Retry identical transient failures with bounded backoff."
			: "Do not automatically retry an ambiguous failure; inspect the target resource or reconcile first.",
	};
}

function defineBridgedOperationSpec(
	declaration: BridgedOperationDeclaration,
): AnyOperationSpec {
	const contract = runtimeOperationContract(declaration.id);
	return defineOperationSpec({
		id: declaration.id,
		resource: declaration.resource,
		verb: declaration.verb,
		title: declaration.title,
		description: declaration.description,
		contract,
		effects: declaration.effects,
		policy: expectedPolicyForEffects(declaration.effects),
		retry: retrySemantics(declaration),
		...(declaration.state === undefined
			? {}
			: { state: declaration.state }),
		agent: agentContext(declaration),
		projection: {
			mcpName: declaration.mcpName,
			openWorld: true,
			graph: {
				descriptorNode:
					"packages/operations/src/specs/bridged.ts#bridgedOperationSpecsById:variable",
				bindingNode:
					"packages/operations/src/specs/bridged.ts#bindBridgedOperationSpec:function",
				runtimeDefinitionNode: `${declaration.runtimeFile}#${declaration.runtimeDefinition}:variable`,
				invokerNode: `${declaration.runtimeFile}#${declaration.invoker}:function`,
				executorNode: `${declaration.runtimeFile}#${declaration.executor}:function`,
			},
		},
		stability: "experimental",
		since: "0.9.0",
	} as OperationSpec<readonly OperationEffect[]>);
}

const bridgedOperationDeclarations = [
	{
		id: "subscribers.create",
		resource: "subscriber",
		verb: "create",
		title: "Create subscriber",
		description: "Create a subscriber in Listmonk",
		mcpName: "listmonk_create_subscriber",
		effects: write("subscriber", true),
		idempotent: false,
		runtimeFile: "packages/operations/src/subscribers.ts",
		runtimeDefinition: "createSubscriberOperation",
		invoker: "invokeCreateSubscriberOperation",
		executor: "createSubscriber",
		verifyWith: ["subscribers.list"],
	},
	{
		id: "subscribers.update",
		resource: "subscriber",
		verb: "update",
		title: "Update subscriber",
		description: "Update a subscriber in Listmonk",
		mcpName: "listmonk_update_subscriber",
		effects: write("subscriber", true),
		idempotent: true,
		runtimeFile: "packages/operations/src/subscribers.ts",
		runtimeDefinition: "updateSubscriberOperation",
		invoker: "invokeUpdateSubscriberOperation",
		executor: "updateSubscriber",
		prerequisites: ["subscribers.get"],
		verifyWith: ["subscribers.get"],
	},
	{
		id: "subscribers.delete",
		resource: "subscriber",
		verb: "delete",
		title: "Delete subscriber",
		description: "Delete a subscriber from Listmonk",
		mcpName: "listmonk_delete_subscriber",
		effects: remove("subscriber"),
		idempotent: true,
		runtimeFile: "packages/operations/src/subscribers.ts",
		runtimeDefinition: "deleteSubscriberOperation",
		invoker: "invokeDeleteSubscriberOperation",
		executor: "deleteSubscriber",
		prerequisites: ["subscribers.get"],
		verifyWith: ["subscribers.list"],
	},
	{
		id: "subscribers.add-to-lists",
		resource: "subscriber",
		verb: "add-to-lists",
		title: "Add subscribers to lists",
		description:
			"Add a batch of subscribers to one or more lists. Processes subscribers in chunks and supports dry-run, max-items cap, and continue-on-error.",
		mcpName: "listmonk_add_subscribers_to_lists",
		effects: write("subscriber", true, true),
		idempotent: true,
		runtimeFile: "packages/operations/src/subscribers.ts",
		runtimeDefinition: "addSubscribersToListsOperation",
		invoker: "invokeAddSubscribersToListsOperation",
		executor: "addSubscribersToLists",
		prerequisites: ["subscribers.get", "lists.get"],
		verifyWith: ["subscribers.get"],
		related: ["subscribers.remove-from-lists"],
	},
	{
		id: "subscribers.remove-from-lists",
		resource: "subscriber",
		verb: "remove-from-lists",
		title: "Remove subscribers from lists",
		description:
			"Remove a batch of subscribers from one or more lists. Processes subscribers in chunks and supports dry-run, max-items cap, and continue-on-error. Destructive because re-adding subscribers does not guarantee their previous per-list subscription state is reconstructed.",
		mcpName: "listmonk_remove_subscribers_from_lists",
		effects: write("subscriber", false, true),
		idempotent: true,
		runtimeFile: "packages/operations/src/subscribers.ts",
		runtimeDefinition: "removeSubscribersFromListsOperation",
		invoker: "invokeRemoveSubscribersFromListsOperation",
		executor: "removeSubscribersFromLists",
		prerequisites: ["subscribers.get", "lists.get"],
		verifyWith: ["subscribers.get"],
		related: ["subscribers.add-to-lists"],
	},
	{
		id: "subscribers.unblocklist",
		resource: "subscriber",
		verb: "unblocklist",
		title: "Unblocklist subscribers",
		description:
			"Remove a batch of subscribers from the blocklist. Processes subscribers in chunks and supports dry-run, max-items cap, and continue-on-error.",
		mcpName: "listmonk_unblocklist_subscribers",
		effects: write("subscriber", true, true),
		idempotent: true,
		runtimeFile: "packages/operations/src/subscribers.ts",
		runtimeDefinition: "unblocklistSubscribersOperation",
		invoker: "invokeUnblocklistSubscribersOperation",
		executor: "unblocklistSubscribers",
		prerequisites: ["subscribers.get"],
		verifyWith: ["subscribers.get"],
		related: ["subscribers.blocklist"],
	},
	{
		id: "campaigns.create",
		resource: "campaign",
		verb: "create",
		title: "Create campaign",
		description: "Create a campaign in Listmonk",
		mcpName: "listmonk_create_campaign",
		effects: write("campaign", true),
		idempotent: false,
		runtimeFile: "packages/operations/src/campaigns.ts",
		runtimeDefinition: "createCampaignOperation",
		invoker: "invokeCreateCampaignOperation",
		executor: "createCampaign",
		verifyWith: ["campaigns.list"],
		related: ["campaigns.update", "campaigns.clone"],
	},
	{
		id: "campaigns.update",
		resource: "campaign",
		verb: "update",
		title: "Update campaign",
		description: "Update a campaign in Listmonk",
		mcpName: "listmonk_update_campaign",
		effects: write("campaign", true),
		idempotent: true,
		runtimeFile: "packages/operations/src/campaigns.ts",
		runtimeDefinition: "updateCampaignOperation",
		invoker: "invokeUpdateCampaignOperation",
		executor: "updateCampaign",
		prerequisites: ["campaigns.get"],
		verifyWith: ["campaigns.get"],
	},
	{
		id: "campaigns.delete",
		resource: "campaign",
		verb: "delete",
		title: "Delete campaign",
		description: "Delete a campaign from Listmonk",
		mcpName: "listmonk_delete_campaign",
		effects: remove("campaign"),
		idempotent: true,
		runtimeFile: "packages/operations/src/campaigns.ts",
		runtimeDefinition: "deleteCampaignOperation",
		invoker: "invokeDeleteCampaignOperation",
		executor: "deleteCampaign",
		prerequisites: ["campaigns.get"],
		verifyWith: ["campaigns.list"],
	},
	{
		id: "campaigns.pause",
		resource: "campaign",
		verb: "pause",
		title: "Pause campaign",
		description:
			"Transition a campaign into the paused status. Validates the current status allows the transition.",
		mcpName: "listmonk_pause_campaign",
		effects: write("campaign", true),
		idempotent: true,
		runtimeFile: "packages/operations/src/campaigns.ts",
		runtimeDefinition: "pauseCampaignOperation",
		invoker: "invokePauseCampaignOperation",
		executor: "pauseCampaign",
		prerequisites: ["campaigns.get"],
		verifyWith: ["campaigns.get"],
		related: ["campaigns.start", "campaigns.cancel"],
		state: {
			resource: "campaign",
			from: ["running"],
			to: "paused",
			allowNoopFromTarget: true,
		},
	},
	{
		id: "campaigns.clone",
		resource: "campaign",
		verb: "clone",
		title: "Clone campaign",
		description:
			"Create a new campaign by copying the body, lists, template, and metadata of an existing campaign under a new name. The clone starts in draft status.",
		mcpName: "listmonk_clone_campaign",
		effects: write("campaign", true),
		idempotent: false,
		runtimeFile: "packages/operations/src/campaigns.ts",
		runtimeDefinition: "cloneCampaignOperation",
		invoker: "invokeCloneCampaignOperation",
		executor: "cloneCampaign",
		prerequisites: ["campaigns.get"],
		verifyWith: ["campaigns.list"],
		related: ["campaigns.create"],
	},
	{
		id: "media.delete",
		resource: "media",
		verb: "delete",
		title: "Delete media file",
		description: "Delete an uploaded media file from Listmonk",
		mcpName: "listmonk_delete_media",
		effects: remove("media"),
		idempotent: true,
		runtimeFile: "packages/operations/src/media.ts",
		runtimeDefinition: "deleteMediaOperation",
		invoker: "invokeDeleteMediaOperation",
		executor: "deleteMediaFile",
		prerequisites: ["media.get"],
		verifyWith: ["media.list"],
	},
	{
		id: "media.upload",
		resource: "media",
		verb: "upload",
		title: "Upload media file",
		description:
			"Upload a media file to Listmonk from base64-encoded contents. Validates an allowlist of MIME types and a 10 MiB size cap before sending.",
		mcpName: "listmonk_upload_media",
		effects: write("media", true),
		idempotent: false,
		runtimeFile: "packages/operations/src/media.ts",
		runtimeDefinition: "uploadMediaOperation",
		invoker: "invokeUploadMediaOperation",
		executor: "uploadMediaFile",
		verifyWith: ["media.list"],
	},
	{
		id: "ops.campaign.deliverability-guard",
		resource: "campaign",
		verb: "deliverability-guard",
		title: "Evaluate deliverability guard",
		description:
			"Evaluate campaign deliverability metrics and optionally pause a breached campaign",
		mcpName: "listmonk_ops_deliverability_guard",
		effects: [
			{ kind: "read", resource: "campaign" },
			{ kind: "write", resource: "campaign", reversible: false },
		],
		idempotent: true,
		runtimeFile: "packages/automation/src/ops-operations.ts",
		runtimeDefinition: "deliverabilityGuardOperation",
		invoker: "invokeDeliverabilityGuardOperation",
		executor: "executeDeliverabilityGuardOperation",
		prerequisites: ["campaigns.get", "campaigns.stats"],
		verifyWith: ["campaigns.get", "campaigns.stats"],
		related: ["campaigns.pause", "ops.digest.daily"],
	},
	{
		id: "ops.subscribers.hygiene",
		resource: "subscriber",
		verb: "hygiene",
		title: "Run subscriber hygiene",
		description: "Run the winback or sunset subscriber hygiene workflow",
		mcpName: "listmonk_ops_subscriber_hygiene",
		effects: [
			{
				kind: "write",
				resource: "subscriber",
				reversible: true,
				preview: true,
			},
			{
				kind: "suppression",
				resource: "subscriber",
				scope: "audience",
				reversible: false,
				preview: true,
			},
		],
		idempotent: false,
		runtimeFile: "packages/automation/src/ops-operations.ts",
		runtimeDefinition: "subscriberHygieneOperation",
		invoker: "invokeSubscriberHygieneOperation",
		executor: "executeSubscriberHygieneOperation",
		prerequisites: ["subscribers.list"],
		verifyWith: ["subscribers.list"],
		related: ["subscribers.blocklist", "subscribers.add-to-lists"],
	},
	{
		id: "ops.segments.drift",
		resource: "audience",
		verb: "drift",
		title: "Detect segment drift",
		description: "Snapshot list sizes and detect subscriber-count drift",
		mcpName: "listmonk_ops_segment_drift",
		effects: [
			{
				kind: "maintenance",
				resource: "audience",
				action: "recover",
				destructive: false,
				preview: false,
			},
		],
		idempotent: false,
		runtimeFile: "packages/automation/src/ops-operations.ts",
		runtimeDefinition: "segmentDriftOperation",
		invoker: "invokeSegmentDriftOperation",
		executor: "executeSegmentDriftOperation",
		prerequisites: ["lists.list"],
		verifyWith: ["lists.list"],
	},
	{
		id: "ops.templates.registry-sync",
		resource: "template",
		verb: "registry-sync",
		title: "Sync template registry",
		description: "Capture Listmonk templates in the local version registry",
		mcpName: "listmonk_ops_template_registry_sync",
		effects: write("template", true),
		idempotent: true,
		runtimeFile: "packages/automation/src/ops-operations.ts",
		runtimeDefinition: "templateRegistrySyncOperation",
		invoker: "invokeTemplateRegistrySyncOperation",
		executor: "executeTemplateRegistrySyncOperation",
		prerequisites: ["templates.list"],
		verifyWith: ["ops.templates.registry-history"],
	},
	{
		id: "ops.templates.registry-history",
		resource: "template",
		verb: "registry-history",
		title: "Read template registry history",
		description: "Read stored template versions from the local registry",
		mcpName: "listmonk_ops_template_registry_history",
		effects: read("template"),
		idempotent: true,
		runtimeFile: "packages/automation/src/ops-operations.ts",
		runtimeDefinition: "templateRegistryHistoryOperation",
		invoker: "invokeTemplateRegistryHistoryOperation",
		executor: "executeTemplateRegistryHistoryOperation",
		related: [
			"ops.templates.registry-promote",
			"ops.templates.registry-rollback",
		],
	},
	{
		id: "ops.templates.registry-promote",
		resource: "template",
		verb: "registry-promote",
		title: "Promote template version",
		description:
			"Promote a stored template version to active Listmonk content",
		mcpName: "listmonk_ops_template_registry_promote",
		effects: write("template", false),
		idempotent: false,
		runtimeFile: "packages/automation/src/ops-operations.ts",
		runtimeDefinition: "templateRegistryPromoteOperation",
		invoker: "invokeTemplateRegistryPromoteOperation",
		executor: "executeTemplateRegistryPromoteOperation",
		prerequisites: ["ops.templates.registry-history", "templates.get"],
		verifyWith: ["templates.get", "ops.templates.registry-history"],
		related: ["ops.templates.registry-rollback"],
	},
	{
		id: "ops.templates.registry-rollback",
		resource: "template",
		verb: "registry-rollback",
		title: "Rollback template version",
		description:
			"Rollback a Listmonk template to its previous stored version",
		mcpName: "listmonk_ops_template_registry_rollback",
		effects: write("template", false),
		idempotent: false,
		runtimeFile: "packages/automation/src/ops-operations.ts",
		runtimeDefinition: "templateRegistryRollbackOperation",
		invoker: "invokeTemplateRegistryRollbackOperation",
		executor: "executeTemplateRegistryRollbackOperation",
		prerequisites: ["ops.templates.registry-history", "templates.get"],
		verifyWith: ["templates.get", "ops.templates.registry-history"],
		related: ["ops.templates.registry-promote"],
	},
	{
		id: "ops.digest.daily",
		resource: "control",
		verb: "daily",
		title: "Generate daily operations digest",
		description:
			"Generate a metrics and deliverability summary for an operations window",
		mcpName: "listmonk_ops_daily_digest",
		effects: read("control"),
		idempotent: true,
		runtimeFile: "packages/automation/src/ops-operations.ts",
		runtimeDefinition: "dailyDigestOperation",
		invoker: "invokeDailyDigestOperation",
		executor: "executeDailyDigestOperation",
		related: [
			"ops.campaign.deliverability-guard",
			"ops.segments.drift",
		],
	},
	{
		id: "abtest.list",
		resource: "experiment",
		verb: "list",
		title: "List A/B tests",
		description: "List persisted A/B tests, optionally filtered by status",
		mcpName: "listmonk_abtest_list",
		effects: read("experiment"),
		idempotent: true,
		runtimeFile: "packages/abtest/src/operations.ts",
		runtimeDefinition: "listAbTestsOperation",
		invoker: "invokeListAbTestsOperation",
		executor: "executeListAbTestsOperation",
		related: ["abtest.get", "abtest.run", "abtest.tick"],
	},
	{
		id: "abtest.get",
		resource: "experiment",
		verb: "get",
		title: "Get A/B test",
		description: "Get persisted A/B test details",
		mcpName: "listmonk_abtest_get",
		effects: read("experiment"),
		idempotent: true,
		runtimeFile: "packages/abtest/src/operations.ts",
		runtimeDefinition: "getAbTestOperation",
		invoker: "invokeGetAbTestOperation",
		executor: "executeGetAbTestOperation",
		related: [
			"abtest.analyze",
			"abtest.run",
			"abtest.export-assignment",
		],
	},
	{
		id: "abtest.create",
		resource: "experiment",
		verb: "create",
		title: "Create A/B test",
		description:
			"Create and persist an A/B test; auto-launch can start its campaigns",
		mcpName: "listmonk_abtest_create",
		effects: [
			{ kind: "write", resource: "experiment", reversible: false },
			{ kind: "write", resource: "campaign", reversible: true },
			{ kind: "write", resource: "list", reversible: true },
			{
				kind: "delivery",
				resource: "campaign",
				audience: "bulk",
				timing: "scheduled",
			},
		],
		idempotent: false,
		runtimeFile: "packages/abtest/src/operations.ts",
		runtimeDefinition: "createAbTestOperation",
		invoker: "invokeCreateAbTestOperation",
		executor: "executeCreateAbTestOperation",
		verifyWith: ["abtest.get"],
		related: ["ops.campaign.preflight", "abtest.launch", "abtest.run"],
	},
	{
		id: "abtest.analyze",
		resource: "experiment",
		verb: "analyze",
		title: "Analyze A/B test",
		description: "Analyze persisted A/B test statistical results",
		mcpName: "listmonk_abtest_analyze",
		effects: read("experiment"),
		idempotent: true,
		runtimeFile: "packages/abtest/src/operations.ts",
		runtimeDefinition: "analyzeAbTestOperation",
		invoker: "invokeAnalyzeAbTestOperation",
		executor: "executeAnalyzeAbTestOperation",
		prerequisites: ["abtest.get"],
		related: ["abtest.deploy-winner", "abtest.export-assignment"],
	},
	{
		id: "abtest.launch",
		resource: "experiment",
		verb: "launch",
		title: "Launch A/B test",
		description: "Launch a draft A/B test",
		mcpName: "listmonk_abtest_launch",
		effects: [
			{ kind: "write", resource: "experiment", reversible: false },
			{
				kind: "delivery",
				resource: "campaign",
				audience: "bulk",
				timing: "scheduled",
			},
		],
		idempotent: false,
		runtimeFile: "packages/abtest/src/operations.ts",
		runtimeDefinition: "launchAbTestOperation",
		invoker: "invokeLaunchAbTestOperation",
		executor: "executeLaunchAbTestOperation",
		prerequisites: ["abtest.get", "ops.campaign.preflight"],
		verifyWith: ["abtest.get"],
		related: ["abtest.stop", "abtest.run"],
	},
	{
		id: "abtest.stop",
		resource: "experiment",
		verb: "stop",
		title: "Stop A/B test",
		description:
			"Stop an A/B test and clean up its non-terminal Listmonk campaigns and temporary lists",
		mcpName: "listmonk_abtest_stop",
		effects: [
			...write("experiment", false),
			...remove("campaign"),
			...remove("list"),
		],
		idempotent: false,
		runtimeFile: "packages/abtest/src/operations.ts",
		runtimeDefinition: "stopAbTestOperation",
		invoker: "invokeStopAbTestOperation",
		executor: "executeStopAbTestOperation",
		prerequisites: ["abtest.get"],
		verifyWith: ["abtest.get"],
		related: ["abtest.reconcile", "abtest.delete"],
	},
	{
		id: "abtest.delete",
		resource: "experiment",
		verb: "delete",
		title: "Delete A/B test",
		description:
			"Delete an A/B test and clean up non-terminal Listmonk campaigns and temporary lists before removing persisted state",
		mcpName: "listmonk_abtest_delete",
		effects: [
			...remove("experiment"),
			...remove("campaign"),
			...remove("list"),
		],
		idempotent: true,
		runtimeFile: "packages/abtest/src/operations.ts",
		runtimeDefinition: "deleteAbTestOperation",
		invoker: "invokeDeleteAbTestOperation",
		executor: "executeDeleteAbTestOperation",
		prerequisites: ["abtest.get"],
		verifyWith: ["abtest.list"],
	},
	{
		id: "abtest.recommend-sample-size",
		resource: "experiment",
		verb: "recommend-sample-size",
		title: "Recommend A/B test sample size",
		description:
			"Get statistical recommendations for test-group sample size",
		mcpName: "listmonk_abtest_recommend_sample_size",
		effects: read("experiment"),
		idempotent: true,
		runtimeFile: "packages/abtest/src/operations.ts",
		runtimeDefinition: "recommendAbTestSampleSizeOperation",
		invoker: "invokeRecommendAbTestSampleSizeOperation",
		executor: "executeRecommendAbTestSampleSizeOperation",
		related: ["abtest.create"],
	},
	{
		id: "abtest.deploy-winner",
		resource: "experiment",
		verb: "deploy-winner",
		title: "Deploy A/B test winner",
		description:
			"Deploy a statistically significant winner to the holdout group",
		mcpName: "listmonk_abtest_deploy_winner",
		effects: [
			{ kind: "write", resource: "experiment", reversible: false },
			{ kind: "write", resource: "campaign", reversible: true },
			{
				kind: "delivery",
				resource: "campaign",
				audience: "bulk",
				timing: "immediate",
			},
		],
		idempotent: false,
		runtimeFile: "packages/abtest/src/operations.ts",
		runtimeDefinition: "deployAbTestWinnerOperation",
		invoker: "invokeDeployAbTestWinnerOperation",
		executor: "executeDeployAbTestWinnerOperation",
		prerequisites: ["abtest.get", "abtest.analyze"],
		verifyWith: ["abtest.get"],
		related: ["abtest.run", "abtest.reconcile"],
	},
	{
		id: "abtest.run",
		resource: "experiment",
		verb: "run",
		title: "Run A/B test step",
		description:
			"Advance a single A/B test one lifecycle step based on its current status",
		mcpName: "listmonk_abtest_run",
		effects: [
			{ kind: "write", resource: "experiment", reversible: false },
			{ kind: "write", resource: "campaign", reversible: true },
			{
				kind: "delivery",
				resource: "campaign",
				audience: "bulk",
				timing: "immediate",
			},
		],
		idempotent: false,
		runtimeFile: "packages/abtest/src/operations.ts",
		runtimeDefinition: "runAbTestOperation",
		invoker: "invokeRunAbTestOperation",
		executor: "executeRunAbTestOperation",
		prerequisites: ["abtest.get"],
		verifyWith: ["abtest.get"],
		related: ["abtest.tick", "abtest.reconcile"],
	},
	{
		id: "abtest.tick",
		resource: "experiment",
		verb: "tick",
		title: "Tick A/B tests",
		description:
			"Advance every non-terminal A/B test one lifecycle step and report the actions taken",
		mcpName: "listmonk_abtest_tick",
		effects: [
			{
				kind: "write",
				resource: "experiment",
				reversible: false,
				preview: true,
			},
			{
				kind: "write",
				resource: "campaign",
				reversible: true,
				preview: true,
			},
			{
				kind: "delivery",
				resource: "campaign",
				audience: "bulk",
				timing: "immediate",
				preview: true,
			},
		],
		idempotent: false,
		runtimeFile: "packages/abtest/src/operations.ts",
		runtimeDefinition: "tickAbTestsOperation",
		invoker: "invokeTickAbTestsOperation",
		executor: "executeTickAbTestsOperation",
		prerequisites: ["abtest.list"],
		verifyWith: ["abtest.list"],
		related: ["abtest.run", "abtest.reconcile"],
	},
	{
		id: "abtest.reconcile",
		resource: "experiment",
		verb: "reconcile",
		title: "Reconcile A/B test state",
		description:
			"Reconcile persisted A/B test state against expected lifecycle state; repairs are destructive when enabled",
		mcpName: "listmonk_abtest_reconcile",
		effects: [
			{
				kind: "maintenance",
				resource: "experiment",
				action: "resolve",
				destructive: true,
				preview: false,
			},
		],
		idempotent: true,
		runtimeFile: "packages/abtest/src/operations.ts",
		runtimeDefinition: "reconcileAbTestOperation",
		invoker: "invokeReconcileAbTestOperation",
		executor: "executeReconcileAbTestOperation",
		prerequisites: ["abtest.get"],
		verifyWith: ["abtest.get"],
		related: ["abtest.run", "abtest.stop"],
	},
	{
		id: "abtest.export-assignment",
		resource: "experiment",
		verb: "export-assignment",
		title: "Export A/B test assignment manifest",
		description:
			"Export the subscriber assignment manifest for a test with deterministic provisioning. Contains subscriber group assignments (no email/PII).",
		mcpName: "listmonk_abtest_export_assignment",
		effects: read("experiment"),
		idempotent: true,
		runtimeFile: "packages/abtest/src/operations.ts",
		runtimeDefinition: "exportAbTestAssignmentOperation",
		invoker: "invokeExportAbTestAssignmentOperation",
		executor: "executeExportAbTestAssignmentOperation",
		prerequisites: ["abtest.get"],
		related: ["abtest.analyze"],
	},
] as const satisfies readonly BridgedOperationDeclaration[];

export const bridgedOperationSpecs = bridgedOperationDeclarations.map(
	defineBridgedOperationSpec,
);

export const bridgedOperationSpecsById = Object.fromEntries(
	bridgedOperationSpecs.map((operation) => [operation.id, operation]),
) as Readonly<Record<BridgedOperationId, AnyOperationSpec>>;

export function bindBridgedOperationSpec<
	const Id extends BridgedOperationId,
>(operationId: Id): (typeof bridgedOperationSpecsById)[Id] {
	const operation = bridgedOperationSpecsById[operationId];
	if (operation === undefined) {
		throw new TypeError(`Missing bridged operation spec ${operationId}`);
	}
	return operation;
}
