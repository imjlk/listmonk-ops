import { defineOperationSpec } from "../operation";
import {
	abTestListInputContract,
	abTestListOutputContract,
	abTestIdInputContract,
	abTestGetOutputContract,
	abTestCreateInputContract,
	abTestAnalyzeInputContract,
	abTestAnalysisOutputContract,
	abTestRunInputContract,
	abTestTickInputContract,
	abTestTickOutputContract,
	abTestReconcileInputContract,
	abTestReconcileOutputContract,
	abTestRecommendSampleSizeInputContract,
	abTestRecommendOutputContract,
	abTestExportAssignmentInputContract,
	abTestExportOutputContract,
	abTestDeleteOutputContract,
	abTestDeployWinnerOutputContract,
} from "../contract-schemas";

export const abTestListOperationSpec = defineOperationSpec({
	id: "abtest.list",
	resource: "experiment",
	verb: "list",
	title: "List A/B tests",
	description: "List persisted A/B tests, optionally filtered by status",
	contract: { input: abTestListInputContract, output: abTestListOutputContract },
	effects: [{ kind: "read", resource: "experiment" }],
	policy: { confirmation: "never", audit: "optional", dryRun: false },
	retry: {
		kind: "safe",
		reason: "The operation only reads persisted A/B tests.",
	},
	agent: {
		useWhen: ["A/B tests must be discovered or enumerated."],
		avoidWhen: ["A specific test ID is already known."],
		prerequisites: [],
		verifyWith: [],
		related: ["abtest.get"],
		retryGuidance: "Retry transient read failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_abtest_list",
		openWorld: true,
		graph: {
			descriptorNode: "packages/operations/src/specs/standalone-specs/abtest-specs.ts#abTestListOperationSpec:variable",
			bindingNode: "packages/operations/src/specs/standalone-specs/abtest-specs.ts#bindAbTestListOperationSpec:function",
			runtimeDefinitionNode: "packages/abtest/src/operations.ts#listAbTestsOperation:variable",
			invokerNode: "packages/abtest/src/operations.ts#invokeListAbTestsOperation:function",
			executorNode: "packages/abtest/src/operations.ts#executeListAbTestsOperation:function",
		},
	},
	stability: "stable",
	since: "0.15.0",
});

export const abTestGetOperationSpec = defineOperationSpec({
	id: "abtest.get",
	resource: "experiment",
	verb: "get",
	title: "Get A/B test",
	description: "Get a specific A/B test by ID",
	contract: { input: abTestIdInputContract, output: abTestGetOutputContract },
	effects: [{ kind: "read", resource: "experiment" }],
	policy: { confirmation: "never", audit: "optional", dryRun: false },
	retry: {
		kind: "safe",
		reason: "The operation only reads a persisted A/B test.",
	},
	agent: {
		useWhen: ["A specific A/B test must be inspected by ID."],
		avoidWhen: ["The test ID is unknown."],
		prerequisites: [],
		verifyWith: [],
		related: ["abtest.list"],
		retryGuidance: "Retry transient read failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_abtest_get",
		openWorld: true,
		graph: {
			descriptorNode: "packages/operations/src/specs/standalone-specs/abtest-specs.ts#abTestGetOperationSpec:variable",
			bindingNode: "packages/operations/src/specs/standalone-specs/abtest-specs.ts#bindAbTestGetOperationSpec:function",
			runtimeDefinitionNode: "packages/abtest/src/operations.ts#getAbTestOperation:variable",
			invokerNode: "packages/abtest/src/operations.ts#invokeGetAbTestOperation:function",
			executorNode: "packages/abtest/src/operations.ts#executeGetAbTestOperation:function",
		},
	},
	stability: "stable",
	since: "0.15.0",
});

export const abTestCreateOperationSpec = defineOperationSpec({
	id: "abtest.create",
	resource: "experiment",
	verb: "create",
	title: "Create A/B test",
	description: "Create a new A/B test with variants and configuration",
	contract: {
		input: abTestCreateInputContract,
		output: abTestGetOutputContract,
	},
	effects: [
		{ kind: "write", resource: "experiment", reversible: true },
		{ kind: "write", resource: "campaign", reversible: true },
		{
			kind: "delivery",
			resource: "campaign",
			audience: "bulk",
			timing: "scheduled",
		},
	],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "unsafe",
		reason: "A retry may create another test, provision duplicate campaigns, or initiate bulk delivery unless the original ID is known.",
	},
	agent: {
		useWhen: ["A new A/B test must be created."],
		avoidWhen: ["An existing test should be updated."],
		prerequisites: [],
		verifyWith: ["abtest.get"],
		related: ["abtest.launch", "abtest.delete"],
		retryGuidance: "Inspect abtest.list before retrying an ambiguous create.",
	},
	projection: {
		mcpName: "listmonk_abtest_create",
		openWorld: true,
		graph: {
			descriptorNode: "packages/operations/src/specs/standalone-specs/abtest-specs.ts#abTestCreateOperationSpec:variable",
			bindingNode: "packages/operations/src/specs/standalone-specs/abtest-specs.ts#bindAbTestCreateOperationSpec:function",
			runtimeDefinitionNode: "packages/abtest/src/operations.ts#createAbTestOperation:variable",
			invokerNode: "packages/abtest/src/operations.ts#invokeCreateAbTestOperation:function",
			executorNode: "packages/abtest/src/operations.ts#executeCreateAbTestOperation:function",
		},
	},
	stability: "experimental",
	since: "0.10.0",
});

export const abTestAnalyzeOperationSpec = defineOperationSpec({
	id: "abtest.analyze",
	resource: "experiment",
	verb: "analyze",
	title: "Analyze A/B test",
	description: "Analyze A/B test results and produce statistical recommendations",
	contract: {
		input: abTestAnalyzeInputContract,
		output: abTestAnalysisOutputContract,
	},
	effects: [{ kind: "read", resource: "experiment" }],
	policy: { confirmation: "never", audit: "optional", dryRun: false },
	retry: {
		kind: "safe",
		reason: "The analysis is a read-only computation over persisted test data.",
	},
	agent: {
		useWhen: ["A/B test results must be statistically evaluated."],
		avoidWhen: ["The test has not started or has insufficient data."],
		prerequisites: ["abtest.get"],
		verifyWith: [],
		related: ["abtest.deploy-winner"],
		retryGuidance: "Retry is safe; the analysis is read-only.",
	},
	projection: {
		mcpName: "listmonk_abtest_analyze",
		openWorld: true,
		graph: {
			descriptorNode: "packages/operations/src/specs/standalone-specs/abtest-specs.ts#abTestAnalyzeOperationSpec:variable",
			bindingNode: "packages/operations/src/specs/standalone-specs/abtest-specs.ts#bindAbTestAnalyzeOperationSpec:function",
			runtimeDefinitionNode: "packages/abtest/src/operations.ts#analyzeAbTestOperation:variable",
			invokerNode: "packages/abtest/src/operations.ts#invokeAnalyzeAbTestOperation:function",
			executorNode: "packages/abtest/src/operations.ts#executeAnalyzeAbTestOperation:function",
		},
	},
	stability: "stable",
	since: "0.15.0",
});

export const abTestLaunchOperationSpec = defineOperationSpec({
	id: "abtest.launch",
	resource: "experiment",
	verb: "launch",
	title: "Launch A/B test",
	description:
		"Schedule every variant campaign for delivery and transition a draft A/B test to scheduled",
	contract: { input: abTestIdInputContract, output: abTestGetOutputContract },
	effects: [
		{ kind: "write", resource: "experiment", reversible: false },
		{ kind: "write", resource: "campaign", reversible: false },
		{
			kind: "delivery",
			resource: "campaign",
			audience: "bulk",
			timing: "scheduled",
		},
	],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "unsafe",
		reason:
			"An ambiguous launch may have scheduled variant campaigns before the persisted test status was updated; repeating it can reschedule delivery.",
	},
	agent: {
		useWhen: ["A draft A/B test is ready to go live."],
		avoidWhen: ["The test has validation errors."],
		prerequisites: ["abtest.get"],
		verifyWith: ["abtest.get"],
		related: ["abtest.stop", "abtest.run"],
		retryGuidance:
			"Inspect abtest.get and the backing Listmonk campaigns before retrying an ambiguous launch.",
	},
	projection: {
		mcpName: "listmonk_abtest_launch",
		openWorld: true,
		graph: {
			descriptorNode: "packages/operations/src/specs/standalone-specs/abtest-specs.ts#abTestLaunchOperationSpec:variable",
			bindingNode: "packages/operations/src/specs/standalone-specs/abtest-specs.ts#bindAbTestLaunchOperationSpec:function",
			runtimeDefinitionNode: "packages/abtest/src/operations.ts#launchAbTestOperation:variable",
			invokerNode: "packages/abtest/src/operations.ts#invokeLaunchAbTestOperation:function",
			executorNode: "packages/abtest/src/operations.ts#executeLaunchAbTestOperation:function",
		},
	},
	stability: "experimental",
	since: "0.10.0",
});

export const abTestStopOperationSpec = defineOperationSpec({
	id: "abtest.stop",
	resource: "experiment",
	verb: "stop",
	title: "Stop A/B test",
	description:
		"Stop a running or scheduled A/B test, cancel or delete its backing campaigns, clean up eligible temporary lists, and transition it to cancelled",
	contract: { input: abTestIdInputContract, output: abTestGetOutputContract },
	effects: [
		{ kind: "write", resource: "experiment", reversible: false },
		{ kind: "write", resource: "campaign", reversible: false },
		{ kind: "delete", resource: "campaign", reversible: false },
		{ kind: "delete", resource: "list", reversible: false },
	],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "unsafe",
		reason:
			"A stop can partially cancel or delete remote resources before persistence is updated, and repeating a completed stop is rejected by the lifecycle guard.",
	},
	agent: {
		useWhen: ["A running or scheduled A/B test must be stopped."],
		avoidWhen: ["The test has already reached a terminal status."],
		prerequisites: ["abtest.get"],
		verifyWith: ["abtest.get"],
		related: ["abtest.launch"],
		retryGuidance:
			"Inspect abtest.get and every backing campaign and temporary list before retrying an ambiguous stop.",
	},
	projection: {
		mcpName: "listmonk_abtest_stop",
		openWorld: true,
		graph: {
			descriptorNode: "packages/operations/src/specs/standalone-specs/abtest-specs.ts#abTestStopOperationSpec:variable",
			bindingNode: "packages/operations/src/specs/standalone-specs/abtest-specs.ts#bindAbTestStopOperationSpec:function",
			runtimeDefinitionNode: "packages/abtest/src/operations.ts#stopAbTestOperation:variable",
			invokerNode: "packages/abtest/src/operations.ts#invokeStopAbTestOperation:function",
			executorNode: "packages/abtest/src/operations.ts#executeStopAbTestOperation:function",
		},
	},
	stability: "experimental",
	since: "0.10.0",
});

export const abTestDeleteOperationSpec = defineOperationSpec({
	id: "abtest.delete",
	resource: "experiment",
	verb: "delete",
	title: "Delete A/B test",
	description:
		"Delete a persisted A/B test and clean up its non-terminal backing campaigns and temporary lists",
	contract: { input: abTestIdInputContract, output: abTestDeleteOutputContract },
	effects: [
		{ kind: "delete", resource: "experiment", reversible: false },
		{ kind: "delete", resource: "campaign", reversible: false },
		{ kind: "delete", resource: "list", reversible: false },
	],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "reconcile",
		reconcileWith: "abtest.list",
		idempotent: false,
		reason:
			"A completed repeat is reported as not found, while an ambiguous first attempt may have removed only some remote resources; verify with abtest.list before deciding whether cleanup is still required.",
	},
	agent: {
		useWhen: ["An A/B test must be permanently removed."],
		avoidWhen: ["The test is still running."],
		prerequisites: ["abtest.get"],
		verifyWith: ["abtest.list"],
		related: ["abtest.stop"],
		retryGuidance:
			"Inspect abtest.list and the remaining backing campaigns and temporary lists before retrying; an ambiguous delete may have removed only some remote resources.",
	},
	projection: {
		mcpName: "listmonk_abtest_delete",
		openWorld: true,
		graph: {
			descriptorNode: "packages/operations/src/specs/standalone-specs/abtest-specs.ts#abTestDeleteOperationSpec:variable",
			bindingNode: "packages/operations/src/specs/standalone-specs/abtest-specs.ts#bindAbTestDeleteOperationSpec:function",
			runtimeDefinitionNode: "packages/abtest/src/operations.ts#deleteAbTestOperation:variable",
			invokerNode: "packages/abtest/src/operations.ts#invokeDeleteAbTestOperation:function",
			executorNode: "packages/abtest/src/operations.ts#executeDeleteAbTestOperation:function",
		},
	},
	stability: "experimental",
	since: "0.10.0",
});

export const abTestRecommendSampleSizeOperationSpec = defineOperationSpec({
	id: "abtest.recommend-sample-size",
	resource: "experiment",
	verb: "recommend-sample-size",
	title: "Recommend A/B test sample size",
	description: "Recommend a sample size and test group percentage for an upcoming A/B test",
	contract: {
		input: abTestRecommendSampleSizeInputContract,
		output: abTestRecommendOutputContract,
	},
	effects: [{ kind: "read", resource: "experiment" }],
	policy: { confirmation: "never", audit: "optional", dryRun: false },
	retry: {
		kind: "safe",
		reason: "The recommendation is a read-only computation over list sizes.",
	},
	agent: {
		useWhen: ["A sample size recommendation is needed before creating a test."],
		avoidWhen: ["The list sizes are unknown."],
		prerequisites: ["lists.list"],
		verifyWith: [],
		related: ["abtest.create"],
		retryGuidance: "Retry is safe; the recommendation is read-only.",
	},
	projection: {
		mcpName: "listmonk_abtest_recommend_sample_size",
		openWorld: true,
		graph: {
			descriptorNode: "packages/operations/src/specs/standalone-specs/abtest-specs.ts#abTestRecommendSampleSizeOperationSpec:variable",
			bindingNode: "packages/operations/src/specs/standalone-specs/abtest-specs.ts#bindAbTestRecommendSampleSizeOperationSpec:function",
			runtimeDefinitionNode: "packages/abtest/src/operations.ts#recommendAbTestSampleSizeOperation:variable",
			invokerNode: "packages/abtest/src/operations.ts#invokeRecommendAbTestSampleSizeOperation:function",
			executorNode: "packages/abtest/src/operations.ts#executeRecommendAbTestSampleSizeOperation:function",
		},
	},
	stability: "stable",
	since: "0.15.0",
});

export const abTestDeployWinnerOperationSpec = defineOperationSpec({
	id: "abtest.deploy-winner",
	resource: "experiment",
	verb: "deploy-winner",
	title: "Deploy A/B test winner",
	description: "Deploy a statistically significant winner to the holdout group",
	contract: {
		input: abTestIdInputContract,
		output: abTestDeployWinnerOutputContract,
	},
	effects: [
		{ kind: "write", resource: "experiment", reversible: false },
		{
			kind: "delivery",
			resource: "campaign",
			audience: "bulk",
			timing: "immediate",
		},
	],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "unsafe",
		reason: "A retry may create another winner campaign and deliver to the holdout audience again.",
	},
	agent: {
		useWhen: ["A winning variant must be deployed to the holdout group."],
		avoidWhen: ["No statistically significant winner has been identified."],
		prerequisites: ["abtest.analyze"],
		verifyWith: ["abtest.get"],
		related: ["abtest.stop"],
		retryGuidance:
			"Inspect abtest.get and the holdout campaign before retrying; an ambiguous deployment may already have delivered to the holdout audience.",
	},
	projection: {
		mcpName: "listmonk_abtest_deploy_winner",
		openWorld: true,
		graph: {
			descriptorNode: "packages/operations/src/specs/standalone-specs/abtest-specs.ts#abTestDeployWinnerOperationSpec:variable",
			bindingNode: "packages/operations/src/specs/standalone-specs/abtest-specs.ts#bindAbTestDeployWinnerOperationSpec:function",
			runtimeDefinitionNode: "packages/abtest/src/operations.ts#deployAbTestWinnerOperation:variable",
			invokerNode: "packages/abtest/src/operations.ts#invokeDeployAbTestWinnerOperation:function",
			executorNode: "packages/abtest/src/operations.ts#executeDeployAbTestWinnerOperation:function",
		},
	},
	stability: "experimental",
	since: "0.10.0",
});

export const abTestRunOperationSpec = defineOperationSpec({
	id: "abtest.run",
	resource: "experiment",
	verb: "run",
	title: "Run A/B test",
	description: "Advance an A/B test by one lifecycle step (launch, analyze, or deploy winner)",
	contract: { input: abTestRunInputContract, output: abTestGetOutputContract },
	effects: [
		{ kind: "write", resource: "experiment", reversible: false },
		{
			kind: "delivery",
			resource: "campaign",
			audience: "bulk",
			timing: "immediate",
		},
	],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "unsafe",
		reason: "A retry may send additional campaigns or shift assignments.",
	},
	agent: {
		useWhen: [
			"An A/B test must run through its lifecycle without manual steps.",
		],
		avoidWhen: ["The test requires manual review between stages."],
		prerequisites: ["abtest.get"],
		verifyWith: ["abtest.get"],
		related: ["abtest.launch", "abtest.stop"],
		retryGuidance: "Inspect abtest.get before retrying an ambiguous run.",
	},
	projection: {
		mcpName: "listmonk_abtest_run",
		openWorld: true,
		graph: {
			descriptorNode: "packages/operations/src/specs/standalone-specs/abtest-specs.ts#abTestRunOperationSpec:variable",
			bindingNode: "packages/operations/src/specs/standalone-specs/abtest-specs.ts#bindAbTestRunOperationSpec:function",
			runtimeDefinitionNode: "packages/abtest/src/operations.ts#runAbTestOperation:variable",
			invokerNode: "packages/abtest/src/operations.ts#invokeRunAbTestOperation:function",
			executorNode: "packages/abtest/src/operations.ts#executeRunAbTestOperation:function",
		},
	},
	stability: "experimental",
	since: "0.10.0",
});

export const abTestTickOperationSpec = defineOperationSpec({
	id: "abtest.tick",
	resource: "experiment",
	verb: "tick",
	title: "Tick A/B tests",
	description: "Advance all non-terminal A/B tests by one step",
	contract: { input: abTestTickInputContract, output: abTestTickOutputContract },
	effects: [
		{ kind: "write", resource: "experiment", reversible: false, preview: true },
		{
			kind: "delivery",
			resource: "campaign",
			audience: "bulk",
			timing: "immediate",
		},
	],
	policy: { confirmation: "required", audit: "required", dryRun: true },
	retry: {
		kind: "unsafe",
		reason: "A retry may advance tests that already transitioned on the previous tick.",
	},
	agent: {
		useWhen: ["Non-terminal A/B tests must be advanced by one lifecycle step."],
		avoidWhen: ["No tests are in a non-terminal status."],
		prerequisites: ["abtest.list"],
		verifyWith: ["abtest.list"],
		related: ["abtest.reconcile"],
		retryGuidance: "Inspect abtest.list before retrying an ambiguous tick.",
	},
	projection: {
		mcpName: "listmonk_abtest_tick",
		openWorld: true,
		graph: {
			descriptorNode: "packages/operations/src/specs/standalone-specs/abtest-specs.ts#abTestTickOperationSpec:variable",
			bindingNode: "packages/operations/src/specs/standalone-specs/abtest-specs.ts#bindAbTestTickOperationSpec:function",
			runtimeDefinitionNode: "packages/abtest/src/operations.ts#tickAbTestsOperation:variable",
			invokerNode: "packages/abtest/src/operations.ts#invokeTickAbTestsOperation:function",
			executorNode: "packages/abtest/src/operations.ts#executeTickAbTestsOperation:function",
		},
	},
	stability: "experimental",
	since: "0.10.0",
});

export const abTestReconcileOperationSpec = defineOperationSpec({
	id: "abtest.reconcile",
	resource: "experiment",
	verb: "reconcile",
	title: "Reconcile A/B test state",
	description: "Reconcile persisted A/B test state against expected lifecycle state",
	contract: {
		input: abTestReconcileInputContract,
		output: abTestReconcileOutputContract,
	},
	effects: [{ kind: "write", resource: "experiment", reversible: false }],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "unsafe",
		reason: "A retry with repair enabled may apply different repairs if state shifted.",
	},
	agent: {
		useWhen: ["Persisted A/B test state must be checked or repaired."],
		avoidWhen: ["No drift is suspected."],
		prerequisites: ["abtest.list"],
		verifyWith: ["abtest.list"],
		related: ["abtest.tick"],
		retryGuidance: "Inspect abtest.list before retrying an ambiguous reconcile.",
	},
	projection: {
		mcpName: "listmonk_abtest_reconcile",
		openWorld: true,
		graph: {
			descriptorNode: "packages/operations/src/specs/standalone-specs/abtest-specs.ts#abTestReconcileOperationSpec:variable",
			bindingNode: "packages/operations/src/specs/standalone-specs/abtest-specs.ts#bindAbTestReconcileOperationSpec:function",
			runtimeDefinitionNode: "packages/abtest/src/operations.ts#reconcileAbTestOperation:variable",
			invokerNode: "packages/abtest/src/operations.ts#invokeReconcileAbTestOperation:function",
			executorNode: "packages/abtest/src/operations.ts#executeReconcileAbTestOperation:function",
		},
	},
	stability: "experimental",
	since: "0.10.0",
});

export const abTestExportAssignmentOperationSpec = defineOperationSpec({
	id: "abtest.export-assignment",
	resource: "experiment",
	verb: "export-assignment",
	title: "Export A/B test assignment manifest",
	description: "Export the subscriber assignment manifest for a test with deterministic provisioning",
	contract: {
		input: abTestExportAssignmentInputContract,
		output: abTestExportOutputContract,
	},
	effects: [{ kind: "read", resource: "experiment" }],
	policy: { confirmation: "never", audit: "optional", dryRun: false },
	retry: {
		kind: "safe",
		reason: "The export is a read-only operation over persisted assignments.",
	},
	agent: {
		useWhen: ["A deterministic assignment manifest must be exported."],
		avoidWhen: ["The test was not provisioned with deterministic assignments."],
		prerequisites: ["abtest.get"],
		verifyWith: [],
		related: [],
		retryGuidance: "Retry is safe; the export is read-only.",
	},
	projection: {
		mcpName: "listmonk_abtest_export_assignment",
		openWorld: true,
		graph: {
			descriptorNode: "packages/operations/src/specs/standalone-specs/abtest-specs.ts#abTestExportAssignmentOperationSpec:variable",
			bindingNode: "packages/operations/src/specs/standalone-specs/abtest-specs.ts#bindAbTestExportAssignmentOperationSpec:function",
			runtimeDefinitionNode: "packages/abtest/src/operations.ts#exportAbTestAssignmentOperation:variable",
			invokerNode: "packages/abtest/src/operations.ts#invokeExportAbTestAssignmentOperation:function",
			executorNode: "packages/abtest/src/operations.ts#executeExportAbTestAssignmentOperation:function",
		},
	},
	stability: "stable",
	since: "0.15.0",
});

export function bindAbTestListOperationSpec(): typeof abTestListOperationSpec {
	return abTestListOperationSpec;
}

export function bindAbTestGetOperationSpec(): typeof abTestGetOperationSpec {
	return abTestGetOperationSpec;
}

export function bindAbTestCreateOperationSpec(): typeof abTestCreateOperationSpec {
	return abTestCreateOperationSpec;
}

export function bindAbTestAnalyzeOperationSpec(): typeof abTestAnalyzeOperationSpec {
	return abTestAnalyzeOperationSpec;
}

export function bindAbTestLaunchOperationSpec(): typeof abTestLaunchOperationSpec {
	return abTestLaunchOperationSpec;
}

export function bindAbTestStopOperationSpec(): typeof abTestStopOperationSpec {
	return abTestStopOperationSpec;
}

export function bindAbTestDeleteOperationSpec(): typeof abTestDeleteOperationSpec {
	return abTestDeleteOperationSpec;
}

export function bindAbTestRecommendSampleSizeOperationSpec(): typeof abTestRecommendSampleSizeOperationSpec {
	return abTestRecommendSampleSizeOperationSpec;
}

export function bindAbTestDeployWinnerOperationSpec(): typeof abTestDeployWinnerOperationSpec {
	return abTestDeployWinnerOperationSpec;
}

export function bindAbTestRunOperationSpec(): typeof abTestRunOperationSpec {
	return abTestRunOperationSpec;
}

export function bindAbTestTickOperationSpec(): typeof abTestTickOperationSpec {
	return abTestTickOperationSpec;
}

export function bindAbTestReconcileOperationSpec(): typeof abTestReconcileOperationSpec {
	return abTestReconcileOperationSpec;
}

export function bindAbTestExportAssignmentOperationSpec(): typeof abTestExportAssignmentOperationSpec {
	return abTestExportAssignmentOperationSpec;
}
