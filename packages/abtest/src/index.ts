// Export all A/B test types
// Export service and integration classes
export {
	AbTestService,
	resolveWinnerDeployment,
	WINNER_DEPLOYMENT_STATUSES,
} from "./abtest-service";
export {
	AbTestCleanupError,
	AbTestInvalidStatusError,
	AbTestOptOutProgressError,
} from "./errors";
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
// Every cleanup path carries opt-outs recorded on a temporary A/B list to the
// test's source lists before deleting the list; these are the building blocks.
export {
	previewTemporaryListOptOuts,
	propagateTemporaryListOptOuts,
	propagateTemporaryListsOptOuts,
	readTemporaryListOptOuts,
	resolveOptOutSourceListIds,
	resolvePendingSourceListIds,
	type TemporaryListOptOut,
	type TemporaryListOptOutPreview,
	type TemporaryListOptOutPropagation,
	type TemporaryListOptOutPropagationStatus,
} from "./unsubscribe-propagation";
// Temporary lists that are kept (completed tests, lists a stop keeps, and
// deleted terminal tests' lists) keep receiving opt-outs; the A/B tick
// carries them with these.
export {
	isOptOutSyncDue,
	isOptOutSyncTracked,
	OPT_OUT_SYNC_INTERVAL_MS,
	OPT_OUT_SYNC_LONG_TAIL_INTERVAL_MS,
	OPT_OUT_SYNC_RECENT_PERIOD_MS,
	resolveTemporaryListIds,
	resolveTrackedTemporaryListIds,
	syncAbTestOptOuts,
	type AbTestOptOutSyncListResult,
	type AbTestOptOutSyncListStatus,
	type AbTestOptOutSyncOutcome,
	type AbTestOptOutSyncResult,
} from "./optout-sync";
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
	SqliteConversionEventStore,
	getConversionEventStorePath,
	resolveConversionStorePath,
	type ConversionEventInput,
	type ConversionEventStore,
	type VariantConversionAggregate,
} from "./conversion-events";
export {
	ANALYZABLE_PRIMARY_METRICS,
	assertAnalyzablePrimaryMetric,
	computeHypothesisChecksum,
	HypothesisValidationError,
	isAnalyzablePrimaryMetric,
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
	evaluatePreRegistration,
	reportToMarkdown,
	reportToJSON,
	type ExperimentReport,
	type PreRegistrationStatus,
} from "./report";
export {
	approvePreviewGate,
	computeContentChecksum,
	createPreviewGate,
	createSeedSendRun,
	DEFAULT_SEED_RECIPIENT_POLICY,
	isLaunchAllowed,
	isSeedRunComplete,
	PreviewValidationError,
	recordPreviewChecks,
	rejectPreviewGate,
	transitionSeedVariant,
	validateSeedRecipients,
	type ContentChecksumInput,
	type PreviewGate,
	type PreviewGateStatus,
	type SeedRecipientPolicy,
	type SeedSendRun,
	type SeedVariantState,
	type VariantPreviewCheck,
} from "./preview";
export {
	ABTEST_STATUSES,
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
	invokeRecordAbTestConversionOperation,
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
	RecordAbTestConversionOperationOutput,
	LaunchAbTestOperationOutput,
	ListAbTestsOperationOutput,
	ReconcileAbTestOperationOutput,
	RecommendAbTestSampleSizeOperationOutput,
	RunAbTestOperationOutput,
	StopAbTestOperationOutput,
	SyncAbTestOptOutsOperationOutput,
	TestAnalysisOperationRecord,
	TickAbTestsOperationOutput,
} from "./operations";
export {
	AbTestConflictError,
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
	AbTestOptOutSyncState,
	AbTestQueryParams,
	AnalyzeAbTestInput,
	CreateAbTestInput,
	Metric,
	StatisticalAnalysis,
	TestAnalysis,
	TestResults,
	Variant,
} from "./types";
