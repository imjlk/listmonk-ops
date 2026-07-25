// Export all A/B test types
// Export service and integration classes
export { AbTestService } from "./abtest-service";
// Export command classes
export {
	AnalyzeAbTestCommand,
	CreateAbTestCommand,
	DeleteAbTestCommand,
	GetAbTestCommand,
	ListAbTestsCommand,
} from "./basic";
export type { AbTestExecutors } from "./factory";
// Export factory function
export { createAbTestExecutors } from "./factory";
export { ListmonkAbTestIntegration } from "./listmonk-integration";
// Export the fail-closed metrics error so consumers can catch it with
// instanceof when getTestResults/analyzeAbTest cannot reach Listmonk.
export {
	AbTestMetricsUnavailableError,
	type MetricsCollector,
} from "./metrics";
// Export the deterministic assignment builder so consumers can inspect or
// re-derive an assignment manifest from a stored seed + audience.
export {
	buildAssignmentManifest,
	generateAssignmentSeed,
	type AssignmentManifest,
} from "./assignment";
export {
	bumpRevision,
	type AbTestStoreAdapter,
	type AbTestStoreQuery,
} from "./store-adapter";
export { InMemoryAbTestStore, JsonFileAbTestStore } from "./store-adapters";
export {
	ConversionEventValidationError,
	InMemoryConversionEventStore,
	type ConversionEventInput,
	type ConversionEventStore,
	type VariantConversionAggregate,
} from "./conversion-events";
export {
	computeHypothesisChecksum,
	HypothesisValidationError,
	lockHypothesis,
	validateHypothesisMetadata,
	verifyHypothesisChecksum,
	type ExpectedLift,
	type ExperimentOwner,
	type ExperimentScope,
	type HypothesisMetadata,
} from "./hypothesis";
export {
	classifyStratum,
	computeStratifiedQuotas,
	createStratumClassifier,
	DEFAULT_STRATIFICATION_POLICY,
	normalizeDomain,
	type StratificationPolicyV1,
	type StratificationResult,
	type StratumQuotaCell,
} from "./stratification";
export {
	COLLISION_KEY_CONTEXT,
	CollisionConfigurationError,
	CollisionConflictError,
	computeActiveWindow,
	computeSubjectKey,
	DEFAULT_COLLISION_POLICY,
	InMemoryExperimentParticipationStore,
	installationKeysMatch,
	isCollisionTimestamp,
	normalizeSubscriberUuid,
	participationsCollide,
	windowsOverlap,
	type CollisionPolicy,
	type CollisionReservationResult,
	type ExperimentParticipation,
	type ExperimentParticipationStore,
} from "./collision";
export {
	buildExperimentReport,
	reportToMarkdown,
	reportToJSON,
	type ExperimentReport,
} from "./report";
export {
	abTestOperationCatalog,
	abTestOperations,
	getAbTestOperationByMcpName,
	invokeAbTestOperationByMcpName,
	invokeAnalyzeAbTestOperation,
	invokeCreateAbTestOperation,
	invokeDeleteAbTestOperation,
	invokeDeployAbTestWinnerOperation,
	invokeExportAbTestAssignmentOperation,
	invokeGetAbTestOperation,
	invokeLaunchAbTestOperation,
	invokeListAbTestsOperation,
	invokeReconcileAbTestOperation,
	invokeRecommendAbTestSampleSizeOperation,
	invokeRunAbTestOperation,
	invokeStopAbTestOperation,
	invokeTickAbTestsOperation,
} from "./operations";
export type {
	AbTestOperation,
	AbTestOperationContext,
	AbTestOperationInvocation,
	AbTestOperationRecord,
	AnalyzeAbTestOperationOutput,
	CreateAbTestOperationOutput,
	DeleteAbTestOperationOutput,
	DeployAbTestWinnerOperationOutput,
	ExportAbTestAssignmentOperationOutput,
	GetAbTestOperationOutput,
	LaunchAbTestOperationOutput,
	ListAbTestsOperationOutput,
	ReconcileAbTestOperationOutput,
	RecommendAbTestSampleSizeOperationOutput,
	RunAbTestOperationOutput,
	StopAbTestOperationOutput,
	TestAnalysisOperationRecord,
	TickAbTestsOperationOutput,
} from "./operations";
export {
	AbTestNotFoundError,
	AbTestWriteTransactionError,
	getAbTestStorePath,
	loadStoredAbTests,
	saveStoredAbTests,
	validateStoredAbTestStore,
	withStoredAbTestExecutors,
} from "./persistence";
export type { AbTestStore, StoredAbTestAccessOptions } from "./persistence";
export type {
	AbTest,
	AbTestConfig,
	AbTestInput,
	AbTestQueryParams,
	AnalyzeAbTestInput,
	CreateAbTestInput,
	Metric,
	StatisticalAnalysis,
	TestAnalysis,
	TestResults,
	Variant,
} from "./types";
