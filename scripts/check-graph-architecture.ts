type GraphNode = {
	id: string;
};

type GraphEdge = {
	from: string;
	to: string;
	kind: string;
};

export type GraphDump = {
	nodes: GraphNode[];
	edges: GraphEdge[];
};

export type CallPathContract = {
	label: string;
	path: readonly string[];
};

const cliListHandler =
	"apps/cli/src/commands/lists.ts#handleListListsCommand:function";
const cliListRenderer =
	"apps/cli/src/commands/lists.ts#renderSubscriberLists:function";
const cliCreateListHandler =
	"apps/cli/src/commands/lists.ts#handleCreateListCommand:function";
const cliCreateListRenderer =
	"apps/cli/src/commands/lists.ts#renderCreateSubscriberList:function";
const cliUpdateListHandler =
	"apps/cli/src/commands/lists.ts#handleUpdateListCommand:function";
const cliUpdateListRenderer =
	"apps/cli/src/commands/lists.ts#renderUpdateSubscriberList:function";
const cliDeleteListHandler =
	"apps/cli/src/commands/lists.ts#handleDeleteListCommand:function";
const cliDeleteListRenderer =
	"apps/cli/src/commands/lists.ts#renderDeleteSubscriberList:function";
const cliClientResolver =
	"apps/cli/src/lib/listmonk.ts#getListmonkClient:function";
const cliSessionResolver =
	"apps/cli/src/lib/listmonk.ts#resolveListmonkSession:function";
const mcpCallTool =
	"packages/mcp/src/server.ts#ListmonkMCPServer.callTool:method";
const mcpConstructor =
	"packages/mcp/src/server.ts#ListmonkMCPServer.__constructor:method";
const mcpHttpTransportTest =
	"packages/mcp/tests/unit/http-transport.test.ts#packages/mcp/tests/unit/http-transport.test.ts:module";
const mcpHttpTestServerFactory =
	"packages/mcp/tests/unit/http-transport.test.ts#createServer:function";
const mcpServerFactory =
	"packages/mcp/src/server.ts#createListmonkMCPServer:function";
const mcpGetApp =
	"packages/mcp/src/server.ts#ListmonkMCPServer.getApp:method";
const mcpListen =
	"packages/mcp/src/server.ts#ListmonkMCPServer.listen:method";
const mcpSecureHttpBinding =
	"packages/mcp/src/server.ts#ListmonkMCPServer.assertSecureHttpBinding:method";
const mcpSetupMiddleware =
	"packages/mcp/src/server.ts#ListmonkMCPServer.setupMiddleware:method";
const mcpValidateHttpRequest =
	"packages/mcp/src/server.ts#ListmonkMCPServer.validateHttpRequest:method";
const mcpAllowedHttpOrigin =
	"packages/mcp/src/server.ts#ListmonkMCPServer.isAllowedHttpOrigin:method";
const mcpBearerTokenMatches =
	"packages/mcp/src/server.ts#bearerTokenMatches:function";
const mcpSetupRoutes =
	"packages/mcp/src/server.ts#ListmonkMCPServer.setupRoutes:method";
const mcpHandleHttpRequest =
	"packages/mcp/src/server.ts#ListmonkMCPServer.handleMCPHttpRequest:method";
const mcpListsHandler =
	"packages/mcp/src/handlers/lists.ts#handleListsTools:variable";
const listDispatcher =
	"packages/operations/src/lists.ts#invokeListOperationByMcpName:function";
const getListsInvoker =
	"packages/operations/src/lists.ts#invokeGetListsOperation:function";
const createListInvoker =
	"packages/operations/src/lists.ts#invokeCreateListOperation:function";
const updateListInvoker =
	"packages/operations/src/lists.ts#invokeUpdateListOperation:function";
const deleteListInvoker =
	"packages/operations/src/lists.ts#invokeDeleteListOperation:function";
const listAction =
	"packages/operations/src/lists.ts#listSubscriberLists:function";
const createListAction =
	"packages/operations/src/lists.ts#createSubscriberList:function";
const updateListAction =
	"packages/operations/src/lists.ts#updateSubscriberList:function";
const deleteListAction =
	"packages/operations/src/lists.ts#deleteSubscriberList:function";
const openapiListMethod =
	"packages/openapi/src/client/crud.ts#CrudOperations.list:method";
const openapiCreateMethod =
	"packages/openapi/src/client/crud.ts#CrudOperations.create:method";
const openapiUpdateMethod =
	"packages/openapi/src/client/crud.ts#CrudOperations.update:method";
const openapiDeleteMethod =
	"packages/openapi/src/client/crud.ts#CrudOperations.delete:method";
const openapiFactory =
	"packages/openapi/src/client/factory.ts#createListmonkClient:function";
const openapiListFactory =
	"packages/openapi/src/client/resource-operations.ts#createListOperations:function";
const openapiCrudFactory =
	"packages/openapi/src/client/crud.ts#createCrudOperations:function";
const cliTransactionalHandler =
	"apps/cli/src/commands/tx.ts#handleSendTransactionalCommand:function";
const cliTransactionalRenderer =
	"apps/cli/src/commands/tx.ts#renderTransactionalSend:function";
const mcpTransactionalHandler =
	"packages/mcp/src/handlers/transactional.ts#handleTransactionalTools:variable";
const mcpTransactionalToolMatcher =
	"packages/mcp/src/handlers/transactional.ts#isTransactionalToolName:function";
const transactionalDispatcher =
	"packages/operations/src/transactional.ts#invokeTransactionalOperationByMcpName:function";
const transactionalLookup =
	"packages/operations/src/transactional.ts#getTransactionalOperationByMcpName:function";
const sendTransactionalInvoker =
	"packages/operations/src/transactional.ts#invokeSendTransactionalOperation:function";
const sendTransactionalAction =
	"packages/operations/src/transactional.ts#sendTransactionalMessage:function";
const dispatchTransactionalToListmonk =
	"packages/operations/src/transactional.ts#dispatchToListmonk:function";
const transactionalIdempotencyCommitBestEffort =
	"packages/operations/src/transactional.ts#commitBestEffort:function";
const transactionalIdempotencyReleaseBestEffort =
	"packages/operations/src/transactional.ts#releaseBestEffort:function";
const transactionalSerializePayload =
	"packages/operations/src/transactional-idempotency.ts#serializeTransactionalPayload:function";
// File-backed implementation lives in common (Node-only) so the operations
// package stays runtime-neutral; adapters inject it via the interface.
const commonTransactionalClaim =
	"packages/common/src/transactional-idempotency-store.ts#claimTransactionalSend:function";
const commonTransactionalCommit =
	"packages/common/src/transactional-idempotency-store.ts#commitTransactionalSend:function";
const commonTransactionalRelease =
	"packages/common/src/transactional-idempotency-store.ts#releaseTransactionalSend:function";
const commonTransactionalStoreFactory =
	"packages/common/src/transactional-idempotency-store.ts#createFileBackedTransactionalIdempotencyStore:function";
const commonTransactionalHash =
	"packages/common/src/transactional-idempotency-store.ts#hashTransactionalPayload:function";
const transactionalIdempotencyStoreUpdate =
	"packages/common/src/json-file-store.ts#updateJsonFileStore:function";
const transactionalIdempotencyStoreTest =
	"packages/common/tests/transactional-idempotency-store.test.ts#packages/common/tests/transactional-idempotency-store.test.ts:module";
const openapiTransactionalMethod =
	"packages/openapi/src/client/contracts.ts#TransactionalOperations.send:method";
const mcpTestClientCallTool =
	"packages/mcp/tests/mcp-helper.ts#MCPTestClient.callTool:method";
const mcpTransactionalE2eTest =
	"packages/mcp/tests/e2e/transactional.test.ts#packages/mcp/tests/e2e/transactional.test.ts:module";
const cliMcpTransactionalParityE2eTest =
	"packages/mcp/tests/e2e/transactional-parity.test.ts#packages/mcp/tests/e2e/transactional-parity.test.ts:module";
const cliTransactionalParityRunner =
	"packages/mcp/tests/e2e/transactional-parity.test.ts#runCliTransactionalSend:function";
const findMailpitMessage =
	"packages/mcp/tests/e2e/mailpit.ts#findMailpitMessage:function";
const findMailpitMessages =
	"packages/mcp/tests/e2e/mailpit.ts#findMailpitMessages:function";
const fetchMailpitJson =
	"packages/mcp/tests/e2e/mailpit.ts#fetchMailpitJson:function";
const mailpitHelperRegressionTest =
	"packages/mcp/tests/unit/mailpit.test.ts#packages/mcp/tests/unit/mailpit.test.ts:module";

const cliOperationCatalogHandler =
	"apps/cli/src/commands/operations.ts#handleListOperationsCommand:function";
const cliOperationCatalogOutput =
	"apps/cli/src/commands/operations.ts#getOperationCatalogOutput:function";
const cliOperationCatalogSummary =
	"apps/cli/src/operation-catalog.ts#listCliOperationCatalogSummaries:function";
const cliOperationCatalogComposer =
	"apps/cli/src/operation-catalog.ts#cliOperationCatalog:variable";
const mcpOperationCatalogHandler =
	"packages/mcp/src/handlers/catalog.ts#handleOperationCatalogTools:variable";
const mcpOperationCatalogSummary =
	"packages/mcp/src/operation-catalog.ts#listMcpOperationCatalogSummaries:function";
const mcpOperationCatalogComposer =
	"packages/mcp/src/operation-catalog.ts#mcpOperationCatalog:variable";
const sharedOperationCatalogComposer =
	"packages/operations/src/catalog.ts#composeOperationCatalogs:function";
const sharedOperationCatalogSummary =
	"packages/operations/src/catalog.ts#listOperationCatalogSummaries:function";
const sharedOperationCatalogEntrySummary =
	"packages/operations/src/catalog.ts#toSummary:function";
const sharedOperationExecutionPolicy =
	"packages/operations/src/execution-policy.ts#getOperationExecutionPolicy:function";
const sharedOperationEffectiveDryRun =
	"packages/operations/src/execution-policy.ts#getOperationEffectiveDryRun:function";
const sharedOperationConfirmation =
	"packages/operations/src/execution-policy.ts#assertOperationConfirmation:function";
const sharedOperationCatalogLookup =
	"packages/operations/src/catalog.ts#getOperationCatalogEntryByMcpName:function";
const operationExecutionPolicyTest =
	"packages/operations/tests/execution-policy.test.ts#packages/operations/tests/execution-policy.test.ts:module";
const operationAuditTest =
	"packages/common/tests/operation-audit.test.ts#packages/common/tests/operation-audit.test.ts:module";
const recordOperationAudit =
	"packages/common/src/operation-audit.ts#recordOperationAudit:function";
const recordOperationAuditWithLifecycle =
	"packages/automation/src/outbound-webhooks.ts#recordOperationAuditWithLifecycle:function";
const enqueueOperationLifecycleEvent =
	"packages/automation/src/outbound-webhooks.ts#enqueueOperationLifecycleEvent:function";
const enqueueSuccessfulOperationLifecycleEvents =
	"packages/automation/src/outbound-webhook-domain-events.ts#enqueueSuccessfulOperationLifecycleEvents:function";
const projectSuccessfulOperationLifecycleEvents =
	"packages/automation/src/outbound-webhook-domain-events.ts#projectSuccessfulOperationLifecycleEvents:function";
const domainLifecycleProjectionTest =
	"packages/automation/tests/outbound-webhook-domain-events.test.ts#packages/automation/tests/outbound-webhook-domain-events.test.ts:module";
const updateJsonFileStore =
	"packages/common/src/json-file-store.ts#updateJsonFileStore:function";
const mcpOperationExecutionTest =
	"packages/mcp/tests/unit/operation-execution.test.ts#packages/mcp/tests/unit/operation-execution.test.ts:module";
const mcpOperationExecutionResolver =
	"packages/mcp/src/operation-execution.ts#getMcpOperationExecution:function";
const mcpOperationDryRunAssertion =
	"packages/mcp/src/operation-execution.ts#assertMcpOperationDryRun:function";
const mcpOperationAuditRecorder =
	"packages/mcp/src/server.ts#ListmonkMCPServer.recordMcpOperationAudit:method";
const mcpOperationExecutionCompleter =
	"packages/mcp/src/server.ts#ListmonkMCPServer.completeMcpOperationExecution:method";
const cliDefineCommand = "apps/cli/src/lib/command.ts#defineCommand:function";
const cliCommandAdapterTest =
	"apps/cli/tests/command.test.ts#apps/cli/tests/command.test.ts:module";
const cliOperationExecutionTest =
	"apps/cli/tests/operation-execution.test.ts#apps/cli/tests/operation-execution.test.ts:module";
const cliOperationExecutionResolver =
	"apps/cli/src/operation-execution.ts#getCliOperationExecution:function";
const cliOperationExecutor =
	"apps/cli/src/operation-execution.ts#executeCliOperation:function";
const cliOperationAuditRecorder =
	"apps/cli/src/operation-execution.ts#recordCliOperationAudit:function";
const cliOperationCatalogTest =
	"apps/cli/tests/operation-catalog.test.ts#apps/cli/tests/operation-catalog.test.ts:module";
const mcpOperationCatalogTest =
	"packages/mcp/tests/unit/catalog.test.ts#packages/mcp/tests/unit/catalog.test.ts:module";
const operationCatalogParityTest =
	"scripts/operation-coverage.test.ts#scripts/operation-coverage.test.ts:module";
const cliMcpTemplateParityE2eTest =
	"packages/mcp/tests/e2e/templates-parity.test.ts#packages/mcp/tests/e2e/templates-parity.test.ts:module";
const cliTemplateParityRunner =
	"packages/mcp/tests/e2e/templates-parity.test.ts#runCliSetDefaultTemplate:function";
const cliMcpMediaParityE2eTest =
	"packages/mcp/tests/e2e/media-parity.test.ts#packages/mcp/tests/e2e/media-parity.test.ts:module";
const cliMediaGetParityRunner =
	"packages/mcp/tests/e2e/media-parity.test.ts#runCliGetMediaFile:function";
const cliMediaDeleteParityRunner =
	"packages/mcp/tests/e2e/media-parity.test.ts#runCliDeleteMedia:function";
const mediaGetInvoker =
	"packages/operations/src/media.ts#invokeGetMediaFileOperation:function";
const mediaGetAction = "packages/operations/src/media.ts#getMediaFile:function";
const mediaDeleteInvoker =
	"packages/operations/src/media.ts#invokeDeleteMediaOperation:function";
const mediaDeleteAction =
	"packages/operations/src/media.ts#deleteMediaFile:function";
const templateSetDefaultInvoker =
	"packages/operations/src/templates.ts#invokeSetDefaultTemplateOperation:function";
const templateSetDefaultAction =
	"packages/operations/src/templates.ts#setDefaultTemplate:function";
const openapiTemplateSetDefaultMethod =
	"packages/openapi/src/client/contracts.ts#TemplateOperations.setAsDefault:method";
const openapiMediaListMethod =
	"packages/openapi/src/client/contracts.ts#MediaOperations.list:method";
const openapiMediaGetByIdMethod =
	"packages/openapi/src/client/contracts.ts#MediaOperations.getById:method";
const openapiMediaDeleteByIdMethod =
	"packages/openapi/src/client/contracts.ts#MediaOperations.deleteById:method";
const openapiCampaignArchiveMethod =
	"packages/openapi/src/client/contracts.ts#CampaignOperations.updateArchive:method";
const openapiSubscriberOptinMethod =
	"packages/openapi/src/client/contracts.ts#SubscriberOperations.sendOptin:method";
const openapiSystemAboutMethod =
	"packages/openapi/src/client/contracts.ts#SystemOperations.getAbout:method";
const openapiSystemLogsMethod =
	"packages/openapi/src/client/contracts.ts#SystemOperations.getLogs:method";
const openapiSubscriberExportMethod =
	"packages/openapi/src/client/contracts.ts#SubscriberOperations.export:method";
const openapiTemplatePreviewMethod =
	"packages/openapi/src/client/contracts.ts#TemplateOperations.preview:method";
const openapiImportLogsMethod =
	"packages/openapi/src/client/contracts.ts#ImportOperations.logs:method";
const openapiImportStartMethod =
	"packages/openapi/src/client/contracts.ts#ImportOperations.start:method";
const openapiImportGetMethod =
	"packages/openapi/src/client/contracts.ts#ImportOperations.get:method";
const openapiImportStopMethod =
	"packages/openapi/src/client/contracts.ts#ImportOperations.stop:method";
const openapiDashboardCountsMethod =
	"packages/openapi/src/client/contracts.ts#DashboardOperations.getCounts:method";
const openapiDashboardChartsMethod =
	"packages/openapi/src/client/contracts.ts#DashboardOperations.getCharts:method";
const openapiCampaignAnalyticsMethod =
	"packages/openapi/src/client/contracts.ts#CampaignOperations.getAnalytics:method";
const openapiCampaignPreviewMethod =
	"packages/openapi/src/client/contracts.ts#CampaignOperations.preview:method";
const openapiCampaignTestMethod =
	"packages/openapi/src/client/contracts.ts#CampaignOperations.test:method";
const openapiBounceListMethod =
	"packages/openapi/src/client/contracts.ts#BounceOperations.list:method";
const openapiBounceGetByIdMethod =
	"packages/openapi/src/client/contracts.ts#BounceOperations.getById:method";
const openapiBounceDeleteByIdMethod =
	"packages/openapi/src/client/contracts.ts#BounceOperations.deleteById:method";

const cliOpsModule =
	"apps/cli/src/commands/ops.ts#apps/cli/src/commands/ops.ts:module";
const mcpOpsHandler = "packages/mcp/src/handlers/ops.ts#handleOpsTools:variable";
const opsDispatcher =
	"packages/automation/src/ops-operations.ts#invokeOpsOperationByMcpName:function";

const cliAbTestModule =
	"apps/cli/src/commands/abtest.ts#apps/cli/src/commands/abtest.ts:module";
const mcpAbTestHandler =
	"packages/mcp/src/handlers/abtest.ts#handleAbTestTools:variable";
const abTestDispatcher =
	"packages/abtest/src/operations.ts#invokeAbTestOperationByMcpName:function";

const abTestOperationDefinitions = [
	[
		"list",
		"invokeCliListAbTests",
		"invokeListAbTestsOperation",
		"executeListAbTestsOperation",
	],
	[
		"get",
		"invokeCliGetAbTest",
		"invokeGetAbTestOperation",
		"executeGetAbTestOperation",
	],
	[
		"create",
		"invokeCliCreateAbTest",
		"invokeCreateAbTestOperation",
		"executeCreateAbTestOperation",
	],
	[
		"analyze",
		"invokeCliAnalyzeAbTest",
		"invokeAnalyzeAbTestOperation",
		"executeAnalyzeAbTestOperation",
	],
	[
		"launch",
		"invokeCliLaunchAbTest",
		"invokeLaunchAbTestOperation",
		"executeLaunchAbTestOperation",
	],
	[
		"stop",
		"invokeCliStopAbTest",
		"invokeStopAbTestOperation",
		"executeStopAbTestOperation",
	],
	[
		"delete",
		"invokeCliDeleteAbTest",
		"invokeDeleteAbTestOperation",
		"executeDeleteAbTestOperation",
	],
	[
		"recommend sample size",
		"invokeCliRecommendAbTestSampleSize",
		"invokeRecommendAbTestSampleSizeOperation",
		"executeRecommendAbTestSampleSizeOperation",
	],
	[
		"deploy winner",
		"invokeCliDeployAbTestWinner",
		"invokeDeployAbTestWinnerOperation",
		"executeDeployAbTestWinnerOperation",
	],
	[
		"run",
		"invokeCliRunAbTest",
		"invokeRunAbTestOperation",
		"executeRunAbTestOperation",
	],
	[
		"tick",
		"invokeCliTickAbTests",
		"invokeTickAbTestsOperation",
		"executeTickAbTestsOperation",
	],
	[
		"reconcile",
		"invokeCliReconcileAbTest",
		"invokeReconcileAbTestOperation",
		"executeReconcileAbTestOperation",
	],
	[
		"export assignment",
		"invokeCliExportAbTestAssignment",
		"invokeExportAbTestAssignmentOperation",
		"executeExportAbTestAssignmentOperation",
	],
] as const;

const abTestOperationContracts: readonly CallPathContract[] =
	abTestOperationDefinitions.flatMap(
		([label, cliAdapter, invoker, executor]) => [
			{
				label: `CLI A/B ${label} reaches the named operation action`,
				path: [
					cliAbTestModule,
					`apps/cli/src/commands/abtest.ts#${cliAdapter}:function`,
					`packages/abtest/src/operations.ts#${invoker}:function`,
					`packages/abtest/src/operations.ts#${executor}:function`,
				],
			},
			{
				label: `MCP A/B ${label} reaches the named operation action`,
				path: [
					mcpCallTool,
					mcpAbTestHandler,
					abTestDispatcher,
					`packages/abtest/src/operations.ts#${invoker}:function`,
					`packages/abtest/src/operations.ts#${executor}:function`,
				],
			},
		],
	);

const abTestOperationTestModule =
	"packages/abtest/tests/operations.test.ts#packages/abtest/tests/operations.test.ts:module";
const cliAbTestInputTestModule =
	"apps/cli/tests/abtest.test.ts#apps/cli/tests/abtest.test.ts:module";

const abTestTestContracts: readonly CallPathContract[] = [
	...abTestOperationDefinitions.map(([label, , invoker]) => ({
		label: `A/B operation tests anchor the shared ${label} invoker`,
		path: [
			abTestOperationTestModule,
			`packages/abtest/src/operations.ts#${invoker}:function`,
		],
	})),
	// Direct-import anchors for the new domain modules introduced by the
	// correctness hotfix. Each test file imports its source module by name so
	// the graph keeps the symbol edge alive even when no operation executor
	// references it yet.
	{
		label: "Allocation tests anchor the largest-remainder helper",
		path: [
			"packages/abtest/tests/allocation.test.ts#packages/abtest/tests/allocation.test.ts:module",
			"packages/abtest/src/allocation.ts#allocateByLargestRemainder:function",
		],
	},
	{
		label: "Audience tests anchor the audience resolver",
		path: [
			"packages/abtest/tests/audience.test.ts#packages/abtest/tests/audience.test.ts:module",
			"packages/abtest/src/audience.ts#createListmonkAudienceResolver:function",
		],
	},
	{
		label: "Metrics tests anchor the metrics collector",
		path: [
			"packages/abtest/tests/metrics.test.ts#packages/abtest/tests/metrics.test.ts:module",
			"packages/abtest/src/metrics.ts#ListmonkMetricsCollector.collect:method",
		],
	},
	{
		label: "Lifecycle tests anchor the cancel plan helper",
		path: [
			"packages/abtest/tests/lifecycle.test.ts#packages/abtest/tests/lifecycle.test.ts:module",
			"packages/abtest/src/lifecycle.ts#planCancelAbTest:function",
		],
	},
	{
		label: "Assignment tests anchor the deterministic manifest builder",
		path: [
			"packages/abtest/tests/assignment.test.ts#packages/abtest/tests/assignment.test.ts:module",
			"packages/abtest/src/assignment.ts#buildAssignmentManifest:function",
		],
	},
	{
		label: "Bulk membership tests anchor the chunked manageLists adapter",
		path: [
			"packages/abtest/tests/bulk-membership.test.ts#packages/abtest/tests/bulk-membership.test.ts:module",
			"packages/abtest/src/listmonk-integration.ts#ListmonkAbTestIntegration.addSubscribersToListBulk:method",
		],
	},
	{
		label: "Service tests anchor the fail-closed metrics path",
		path: [
			"packages/abtest/tests/abtest-service.test.ts#packages/abtest/tests/abtest-service.test.ts:module",
			"packages/abtest/src/abtest-service.ts#AbTestService.getTestResults:method",
		],
	},
	{
		label: "Statistics tests anchor the Holm correction helper",
		path: [
			"packages/abtest/tests/statistics.test.ts#packages/abtest/tests/statistics.test.ts:module",
			"packages/abtest/src/statistics.ts#applyHolmCorrection:function",
		],
	},
	{
		label: "Hypothesis tests anchor the checksum helper",
		path: [
			"packages/abtest/tests/hypothesis.test.ts#packages/abtest/tests/hypothesis.test.ts:module",
			"packages/abtest/src/hypothesis.ts#computeHypothesisChecksum:function",
		],
	},
	{
		label: "Stratification tests anchor the quota matrix solver",
		path: [
			"packages/abtest/tests/stratification.test.ts#packages/abtest/tests/stratification.test.ts:module",
			"packages/abtest/src/stratification.ts#computeStratifiedQuotas:function",
		],
	},
	{
		label: "Collision tests anchor the participation store",
		path: [
			"packages/abtest/tests/collision.test.ts#packages/abtest/tests/collision.test.ts:module",
			"packages/abtest/src/collision.ts#InMemoryExperimentParticipationStore.checkAndReserve:method",
		],
	},
	{
		label: "Store adapter tests anchor the InMemory store",
		path: [
			"packages/abtest/tests/store-adapter.test.ts#packages/abtest/tests/store-adapter.test.ts:module",
			"packages/abtest/src/store-adapters.ts#InMemoryAbTestStore.transaction:method",
		],
	},
	{
		label: "Report tests anchor the experiment report builder",
		path: [
			"packages/abtest/tests/report.test.ts#packages/abtest/tests/report.test.ts:module",
			"packages/abtest/src/report.ts#buildExperimentReport:function",
		],
	},
	{
		label: "Preview tests anchor the preview gate",
		path: [
			"packages/abtest/tests/preview.test.ts#packages/abtest/tests/preview.test.ts:module",
			"packages/abtest/src/preview.ts#approvePreviewGate:function",
		],
	},
	{
		label: "CLI A/B tests anchor flag normalization",
		path: [
			cliAbTestInputTestModule,
			"apps/cli/src/commands/abtest.ts#buildCreateInputFromFlags:function",
			"apps/cli/src/commands/abtest.ts#normalizeVariants:function",
		],
	},
	{
		label: "MCP A/B tests anchor the shared handler path",
		path: [
			"packages/mcp/tests/unit/abtest.test.ts#packages/mcp/tests/unit/abtest.test.ts:module",
			mcpAbTestHandler,
			abTestDispatcher,
		],
	},
];

const operationCatalogContracts: readonly CallPathContract[] = [
	{
		label: "CLI operation discovery reaches the shared catalog summary",
		path: [
			cliOperationCatalogHandler,
			cliOperationCatalogOutput,
			cliOperationCatalogSummary,
			sharedOperationCatalogSummary,
		],
	},
	{
		label: "MCP operation discovery reaches the shared catalog summary",
		path: [
			mcpCallTool,
			mcpOperationCatalogHandler,
			mcpOperationCatalogSummary,
			sharedOperationCatalogSummary,
		],
	},
	{
		label: "CLI operation catalog composes shared family descriptors",
		path: [cliOperationCatalogComposer, sharedOperationCatalogComposer],
	},
	{
		label: "MCP operation catalog composes shared family descriptors",
		path: [mcpOperationCatalogComposer, sharedOperationCatalogComposer],
	},
	{
		label: "CLI operation catalog tests anchor the discovery output",
		path: [
			cliOperationCatalogTest,
			cliOperationCatalogOutput,
			cliOperationCatalogSummary,
		],
	},
	{
		label: "MCP operation catalog tests anchor the discovery handler",
		path: [
			mcpOperationCatalogTest,
			mcpOperationCatalogHandler,
			mcpOperationCatalogSummary,
		],
	},
	{
		label: "catalog parity tests anchor the CLI summary",
		path: [
			operationCatalogParityTest,
			cliOperationCatalogSummary,
			sharedOperationCatalogSummary,
		],
	},
	{
		label: "catalog parity tests anchor the MCP summary",
		path: [
			operationCatalogParityTest,
			mcpOperationCatalogSummary,
			sharedOperationCatalogSummary,
		],
	},
];

const opsOperationContracts: readonly CallPathContract[] = [
	{
		label: "CLI preflight reaches the campaign automation action",
		path: [
			cliOpsModule,
			"packages/automation/src/ops-operations.ts#invokeCampaignPreflightOperation:function",
			"packages/automation/src/ops-operations.ts#executeCampaignPreflightOperation:function",
			"packages/automation/src/campaign.ts#runCampaignPreflight:function",
		],
	},
	{
		label: "MCP preflight reaches the campaign automation action",
		path: [
			mcpCallTool,
			mcpOpsHandler,
			opsDispatcher,
			"packages/automation/src/ops-operations.ts#invokeCampaignPreflightOperation:function",
			"packages/automation/src/ops-operations.ts#executeCampaignPreflightOperation:function",
			"packages/automation/src/campaign.ts#runCampaignPreflight:function",
		],
	},
	{
		label: "CLI deliverability guard reaches the campaign automation action",
		path: [
			cliOpsModule,
			"packages/automation/src/ops-operations.ts#invokeDeliverabilityGuardOperation:function",
			"packages/automation/src/ops-operations.ts#executeDeliverabilityGuardOperation:function",
			"packages/automation/src/campaign.ts#evaluateDeliverabilityGuard:function",
		],
	},
	{
		label: "MCP deliverability guard reaches the campaign automation action",
		path: [
			mcpCallTool,
			mcpOpsHandler,
			opsDispatcher,
			"packages/automation/src/ops-operations.ts#invokeDeliverabilityGuardOperation:function",
			"packages/automation/src/ops-operations.ts#executeDeliverabilityGuardOperation:function",
			"packages/automation/src/campaign.ts#evaluateDeliverabilityGuard:function",
		],
	},
	{
		label: "CLI subscriber hygiene reaches the automation action",
		path: [
			cliOpsModule,
			"packages/automation/src/ops-operations.ts#invokeSubscriberHygieneOperation:function",
			"packages/automation/src/ops-operations.ts#executeSubscriberHygieneOperation:function",
			"packages/automation/src/hygiene.ts#runSubscriberHygiene:function",
		],
	},
	{
		label: "MCP subscriber hygiene reaches the automation action",
		path: [
			mcpCallTool,
			mcpOpsHandler,
			opsDispatcher,
			"packages/automation/src/ops-operations.ts#invokeSubscriberHygieneOperation:function",
			"packages/automation/src/ops-operations.ts#executeSubscriberHygieneOperation:function",
			"packages/automation/src/hygiene.ts#runSubscriberHygiene:function",
		],
	},
	{
		label: "CLI segment drift reaches the automation action",
		path: [
			cliOpsModule,
			"packages/automation/src/ops-operations.ts#invokeSegmentDriftOperation:function",
			"packages/automation/src/ops-operations.ts#executeSegmentDriftOperation:function",
			"packages/automation/src/segment-drift.ts#runSegmentDriftSnapshot:function",
		],
	},
	{
		label: "MCP segment drift reaches the automation action",
		path: [
			mcpCallTool,
			mcpOpsHandler,
			opsDispatcher,
			"packages/automation/src/ops-operations.ts#invokeSegmentDriftOperation:function",
			"packages/automation/src/ops-operations.ts#executeSegmentDriftOperation:function",
			"packages/automation/src/segment-drift.ts#runSegmentDriftSnapshot:function",
		],
	},
	{
		label: "CLI template sync reaches the automation action",
		path: [
			cliOpsModule,
			"packages/automation/src/ops-operations.ts#invokeTemplateRegistrySyncOperation:function",
			"packages/automation/src/ops-operations.ts#executeTemplateRegistrySyncOperation:function",
			"packages/automation/src/template-registry.ts#syncTemplateRegistry:function",
		],
	},
	{
		label: "MCP template sync reaches the automation action",
		path: [
			mcpCallTool,
			mcpOpsHandler,
			opsDispatcher,
			"packages/automation/src/ops-operations.ts#invokeTemplateRegistrySyncOperation:function",
			"packages/automation/src/ops-operations.ts#executeTemplateRegistrySyncOperation:function",
			"packages/automation/src/template-registry.ts#syncTemplateRegistry:function",
		],
	},
	{
		label: "CLI template history reaches the local registry action",
		path: [
			cliOpsModule,
			"packages/automation/src/ops-operations.ts#invokeTemplateRegistryHistoryOperation:function",
			"packages/automation/src/ops-operations.ts#executeTemplateRegistryHistoryOperation:function",
			"packages/automation/src/template-registry.ts#getTemplateRegistryHistory:function",
		],
	},
	{
		label: "MCP template history reaches the local registry action",
		path: [
			mcpCallTool,
			mcpOpsHandler,
			opsDispatcher,
			"packages/automation/src/ops-operations.ts#invokeTemplateRegistryHistoryOperation:function",
			"packages/automation/src/ops-operations.ts#executeTemplateRegistryHistoryOperation:function",
			"packages/automation/src/template-registry.ts#getTemplateRegistryHistory:function",
		],
	},
	{
		label: "CLI template promotion reaches the registry action",
		path: [
			cliOpsModule,
			"packages/automation/src/ops-operations.ts#invokeTemplateRegistryPromoteOperation:function",
			"packages/automation/src/ops-operations.ts#executeTemplateRegistryPromoteOperation:function",
			"packages/automation/src/template-registry.ts#promoteTemplateVersion:function",
		],
	},
	{
		label: "MCP template promotion reaches the registry action",
		path: [
			mcpCallTool,
			mcpOpsHandler,
			opsDispatcher,
			"packages/automation/src/ops-operations.ts#invokeTemplateRegistryPromoteOperation:function",
			"packages/automation/src/ops-operations.ts#executeTemplateRegistryPromoteOperation:function",
			"packages/automation/src/template-registry.ts#promoteTemplateVersion:function",
		],
	},
	{
		label: "CLI template rollback reaches the registry action",
		path: [
			cliOpsModule,
			"packages/automation/src/ops-operations.ts#invokeTemplateRegistryRollbackOperation:function",
			"packages/automation/src/ops-operations.ts#executeTemplateRegistryRollbackOperation:function",
			"packages/automation/src/template-registry.ts#rollbackTemplateVersion:function",
		],
	},
	{
		label: "MCP template rollback reaches the registry action",
		path: [
			mcpCallTool,
			mcpOpsHandler,
			opsDispatcher,
			"packages/automation/src/ops-operations.ts#invokeTemplateRegistryRollbackOperation:function",
			"packages/automation/src/ops-operations.ts#executeTemplateRegistryRollbackOperation:function",
			"packages/automation/src/template-registry.ts#rollbackTemplateVersion:function",
		],
	},
	{
		label: "CLI daily digest reaches the automation action",
		path: [
			cliOpsModule,
			"packages/automation/src/ops-operations.ts#invokeDailyDigestOperation:function",
			"packages/automation/src/ops-operations.ts#executeDailyDigestOperation:function",
			"packages/automation/src/digest.ts#generateDailyDigest:function",
		],
	},
	{
		label: "MCP daily digest reaches the automation action",
		path: [
			mcpCallTool,
			mcpOpsHandler,
			opsDispatcher,
			"packages/automation/src/ops-operations.ts#invokeDailyDigestOperation:function",
			"packages/automation/src/ops-operations.ts#executeDailyDigestOperation:function",
			"packages/automation/src/digest.ts#generateDailyDigest:function",
		],
	},
];

const listInvokers: readonly (readonly [label: string, invoker: string])[] = [
	[
		"get list",
		"packages/operations/src/lists.ts#invokeGetListOperation:function",
	],
	[
		"create list",
		"packages/operations/src/lists.ts#invokeCreateListOperation:function",
	],
	[
		"update list",
		"packages/operations/src/lists.ts#invokeUpdateListOperation:function",
	],
	[
		"delete list",
		"packages/operations/src/lists.ts#invokeDeleteListOperation:function",
	],
];

const listInvokerContracts: CallPathContract[] = listInvokers.map(
	([label, invoker]) => ({
		label: `MCP dispatcher reaches the named ${label} invoker`,
		path: [listDispatcher, invoker],
	}),
);

const cliListMutationContracts: readonly CallPathContract[] = [
	{
		label: "CLI create-list command reaches the OpenAPI create method",
		path: [
			cliCreateListHandler,
			cliCreateListRenderer,
			createListInvoker,
			createListAction,
			openapiCreateMethod,
		],
	},
	{
		label: "CLI update-list command reaches the OpenAPI update method",
		path: [
			cliUpdateListHandler,
			cliUpdateListRenderer,
			updateListInvoker,
			updateListAction,
			openapiUpdateMethod,
		],
	},
	{
		label: "CLI delete-list command reaches the OpenAPI delete method",
		path: [
			cliDeleteListHandler,
			cliDeleteListRenderer,
			deleteListInvoker,
			deleteListAction,
			openapiDeleteMethod,
		],
	},
	{
		label: "CLI list mutation tests anchor create operation path",
		path: [
			"apps/cli/tests/lists.test.ts#apps/cli/tests/lists.test.ts:module",
			cliCreateListRenderer,
			createListInvoker,
		],
	},
	{
		label: "CLI list mutation tests anchor update operation path",
		path: [
			"apps/cli/tests/lists.test.ts#apps/cli/tests/lists.test.ts:module",
			cliUpdateListRenderer,
			updateListInvoker,
		],
	},
	{
		label: "CLI list mutation tests anchor delete operation path",
		path: [
			"apps/cli/tests/lists.test.ts#apps/cli/tests/lists.test.ts:module",
			cliDeleteListRenderer,
			deleteListInvoker,
		],
	},
];

type ResourceOperationContractConfig = {
	resource: string;
	cliModule: string;
	cliTestModule: string;
	mcpHandler: string;
	dispatcher: string;
	operationTestModule: string;
	mcpTestModule: string;
	testAnchor: {
		invoker: string;
		action: string;
	};
	invokers: readonly {
		label: string;
		cliHandler: string;
		cliRender: string;
		invoker: string;
		action: string;
		openapi: string;
	}[];
};

function resourceOperationContracts(
	config: ResourceOperationContractConfig,
): CallPathContract[] {
	const cliFile = config.cliModule.slice(0, config.cliModule.indexOf("#"));
	const operationPaths = config.invokers.flatMap((operation) => [
		{
			label: `CLI ${config.resource} ${operation.label} reaches the shared action`,
			path: [
				`${cliFile}#${operation.cliHandler}:function`,
				`${cliFile}#${operation.cliRender}:function`,
				operation.invoker,
				operation.action,
			],
		},
		{
			label: `MCP ${config.resource} ${operation.label} reaches the OpenAPI CRUD method`,
			path: [
				mcpCallTool,
				config.mcpHandler,
				config.dispatcher,
				operation.invoker,
				operation.action,
				operation.openapi,
			],
		},
	]);
	return [
		...operationPaths,
		{
			label: `CLI ${config.resource} tests anchor the shared renderer`,
			path: [
				config.cliTestModule,
				`${cliFile}#${config.invokers.find((operation) => operation.invoker === config.testAnchor.invoker)?.cliRender}:function`,
				config.testAnchor.invoker,
			],
		},
		{
			label: `MCP ${config.resource} tests anchor the dispatcher`,
			path: [config.mcpTestModule, config.mcpHandler, config.dispatcher],
		},
		{
			label: `Operation tests anchor the ${config.resource} invoker`,
			path: [
				config.operationTestModule,
				config.testAnchor.invoker,
				config.testAnchor.action,
			],
		},
	];
}

const resourceCrudContracts: readonly CallPathContract[] = [
	...resourceOperationContracts({
		resource: "campaign",
		cliModule:
			"apps/cli/src/commands/campaigns.ts#apps/cli/src/commands/campaigns.ts:module",
		cliTestModule:
			"apps/cli/tests/resources.test.ts#apps/cli/tests/resources.test.ts:module",
		mcpHandler: "packages/mcp/src/handlers/campaigns.ts#handleCampaignsTools:variable",
		dispatcher:
			"packages/operations/src/campaigns.ts#invokeCampaignOperationByMcpName:function",
		operationTestModule:
			"packages/operations/tests/resources.test.ts#packages/operations/tests/resources.test.ts:module",
		mcpTestModule:
			"packages/mcp/tests/unit/resources.test.ts#packages/mcp/tests/unit/resources.test.ts:module",
		testAnchor: {
			invoker:
				"packages/operations/src/campaigns.ts#invokeGetCampaignsOperation:function",
			action: "packages/operations/src/campaigns.ts#listCampaigns:function",
		},
		invokers: [
			{
				label: "list",
				cliHandler: "handleListCampaignsCommand",
				cliRender: "renderCampaigns",
				invoker:
					"packages/operations/src/campaigns.ts#invokeGetCampaignsOperation:function",
				action:
					"packages/operations/src/campaigns.ts#listCampaigns:function",
				openapi: openapiListMethod,
			},
			{
				label: "archive",
				cliHandler: "handleArchiveCampaignCommand",
				cliRender: "renderArchiveCampaign",
				invoker:
					"packages/operations/src/campaigns.ts#invokeArchiveCampaignOperation:function",
				action:
					"packages/operations/src/campaigns.ts#archiveCampaign:function",
				openapi: openapiCampaignArchiveMethod,
			},
			{
				label: "analytics",
				cliHandler: "handleCampaignAnalyticsCommand",
				cliRender: "renderCampaignAnalytics",
				invoker:
					"packages/operations/src/campaigns.ts#invokeGetCampaignAnalyticsOperation:function",
				action:
					"packages/operations/src/campaigns.ts#readCampaignAnalytics:function",
				openapi: openapiCampaignAnalyticsMethod,
			},
			{
				label: "preview",
				cliHandler: "handlePreviewCampaignCommand",
				cliRender: "renderPreviewCampaign",
				invoker:
					"packages/operations/src/campaigns.ts#invokePreviewCampaignOperation:function",
				action:
					"packages/operations/src/campaigns.ts#previewCampaign:function",
				openapi: openapiCampaignPreviewMethod,
			},
			{
				label: "test",
				cliHandler: "handleTestCampaignCommand",
				cliRender: "renderTestCampaign",
				invoker:
					"packages/operations/src/campaigns.ts#invokeTestCampaignOperation:function",
				action:
					"packages/operations/src/campaigns.ts#sendTestCampaign:function",
				openapi: openapiCampaignTestMethod,
			},
			{
				label: "get",
				cliHandler: "handleGetCampaignCommand",
				cliRender: "renderCampaign",
				invoker:
					"packages/operations/src/campaigns.ts#invokeGetCampaignOperation:function",
				action: "packages/operations/src/campaigns.ts#getCampaign:function",
				openapi:
					"packages/openapi/src/client/crud.ts#CrudOperations.getById:method",
			},
			{
				label: "create",
				cliHandler: "handleCreateCampaignCommand",
				cliRender: "renderCreateCampaign",
				invoker:
					"packages/operations/src/campaigns.ts#invokeCreateCampaignOperation:function",
				action: "packages/operations/src/campaigns.ts#createCampaign:function",
				openapi: openapiCreateMethod,
			},
			{
				label: "update",
				cliHandler: "handleUpdateCampaignCommand",
				cliRender: "renderUpdateCampaign",
				invoker:
					"packages/operations/src/campaigns.ts#invokeUpdateCampaignOperation:function",
				action: "packages/operations/src/campaigns.ts#updateCampaign:function",
				openapi: openapiUpdateMethod,
			},
			{
				label: "delete",
				cliHandler: "handleDeleteCampaignCommand",
				cliRender: "renderDeleteCampaign",
				invoker:
					"packages/operations/src/campaigns.ts#invokeDeleteCampaignOperation:function",
				action: "packages/operations/src/campaigns.ts#deleteCampaign:function",
				openapi: openapiDeleteMethod,
			},
		],
	}),
	...resourceOperationContracts({
		resource: "system",
		cliModule:
			"apps/cli/src/commands/system.ts#apps/cli/src/commands/system.ts:module",
		cliTestModule:
			"apps/cli/tests/system.test.ts#apps/cli/tests/system.test.ts:module",
		mcpHandler:
			"packages/mcp/src/handlers/system.ts#handleSystemTools:function",
		dispatcher:
			"packages/operations/src/system.ts#invokeSystemOperationByMcpName:function",
		operationTestModule:
			"packages/operations/tests/system.test.ts#packages/operations/tests/system.test.ts:module",
		mcpTestModule:
			"packages/mcp/tests/unit/system.test.ts#packages/mcp/tests/unit/system.test.ts:module",
		testAnchor: {
			invoker:
				"packages/operations/src/system.ts#invokeReadSystemAboutOperation:function",
			action:
				"packages/operations/src/system.ts#readSystemAbout:function",
		},
		invokers: [
			{
				label: "about",
				cliHandler: "handleSystemAboutCommand",
				cliRender: "renderSystemAbout",
				invoker:
					"packages/operations/src/system.ts#invokeReadSystemAboutOperation:function",
				action:
					"packages/operations/src/system.ts#readSystemAbout:function",
				openapi: openapiSystemAboutMethod,
			},
			{
				label: "logs",
				cliHandler: "handleSystemLogsCommand",
				cliRender: "renderSystemLogs",
				invoker:
					"packages/operations/src/system.ts#invokeReadSystemLogsOperation:function",
				action:
					"packages/operations/src/system.ts#readSystemLogs:function",
				openapi: openapiSystemLogsMethod,
			},
		],
	}),
	...resourceOperationContracts({
		resource: "subscriber",
		cliModule:
			"apps/cli/src/commands/subscribers.ts#apps/cli/src/commands/subscribers.ts:module",
		cliTestModule:
			"apps/cli/tests/subscribers-import.test.ts#apps/cli/tests/subscribers-import.test.ts:module",
		mcpHandler: "packages/mcp/src/handlers/subscribers.ts#handleSubscribersTools:function",
		dispatcher:
			"packages/operations/src/subscribers.ts#invokeSubscriberOperationByMcpName:function",
		operationTestModule:
			"packages/operations/tests/subscribers-import.test.ts#packages/operations/tests/subscribers-import.test.ts:module",
		mcpTestModule:
			"packages/mcp/tests/unit/resources.test.ts#packages/mcp/tests/unit/resources.test.ts:module",
		testAnchor: {
			invoker:
				"packages/operations/src/subscribers.ts#invokeStartSubscriberImportOperation:function",
			action:
				"packages/operations/src/subscribers.ts#startSubscriberImport:function",
		},
		invokers: [
			{
				label: "list",
				cliHandler: "handleListSubscribersCommand",
				cliRender: "renderSubscribers",
				invoker:
					"packages/operations/src/subscribers.ts#invokeGetSubscribersOperation:function",
				action:
					"packages/operations/src/subscribers.ts#listSubscribers:function",
				openapi: openapiListMethod,
			},
			{
				label: "get",
				cliHandler: "handleGetSubscriberCommand",
				cliRender: "renderSubscriber",
				invoker:
					"packages/operations/src/subscribers.ts#invokeGetSubscriberOperation:function",
				action: "packages/operations/src/subscribers.ts#getSubscriber:function",
				openapi:
					"packages/openapi/src/client/crud.ts#CrudOperations.getById:method",
			},
			{
				label: "create",
				cliHandler: "handleCreateSubscriberCommand",
				cliRender: "renderCreateSubscriber",
				invoker:
					"packages/operations/src/subscribers.ts#invokeCreateSubscriberOperation:function",
				action:
					"packages/operations/src/subscribers.ts#createSubscriber:function",
				openapi: openapiCreateMethod,
			},
			{
				label: "update",
				cliHandler: "handleUpdateSubscriberCommand",
				cliRender: "renderUpdateSubscriber",
				invoker:
					"packages/operations/src/subscribers.ts#invokeUpdateSubscriberOperation:function",
				action:
					"packages/operations/src/subscribers.ts#updateSubscriber:function",
				openapi: openapiUpdateMethod,
			},
			{
				label: "delete",
				cliHandler: "handleDeleteSubscriberCommand",
				cliRender: "renderDeleteSubscriber",
				invoker:
					"packages/operations/src/subscribers.ts#invokeDeleteSubscriberOperation:function",
				action:
					"packages/operations/src/subscribers.ts#deleteSubscriber:function",
				openapi: openapiDeleteMethod,
			},
			{
				label: "send-optin",
				cliHandler: "handleSendOptinCommand",
				cliRender: "renderSendOptin",
				invoker:
					"packages/operations/src/subscribers.ts#invokeSendOptinOperation:function",
				action:
					"packages/operations/src/subscribers.ts#sendSubscriberOptin:function",
				openapi: openapiSubscriberOptinMethod,
			},
			{
				label: "export",
				cliHandler: "handleExportSubscriberCommand",
				cliRender: "renderExportSubscriber",
				invoker:
					"packages/operations/src/subscribers.ts#invokeExportSubscriberOperation:function",
				action:
					"packages/operations/src/subscribers.ts#exportSubscriber:function",
				openapi: openapiSubscriberExportMethod,
			},
			{
				label: "import start",
				cliHandler: "handleStartSubscriberImportCommand",
				cliRender: "renderStartSubscriberImport",
				invoker:
					"packages/operations/src/subscribers.ts#invokeStartSubscriberImportOperation:function",
				action:
					"packages/operations/src/subscribers.ts#startSubscriberImport:function",
				openapi: openapiImportStartMethod,
			},
			{
				label: "import status",
				cliHandler: "handleSubscriberImportStatusCommand",
				cliRender: "renderSubscriberImportStatus",
				invoker:
					"packages/operations/src/subscribers.ts#invokeGetSubscriberImportStatusOperation:function",
				action:
					"packages/operations/src/subscribers.ts#readSubscriberImportStatus:function",
				openapi: openapiImportGetMethod,
			},
			{
				label: "import logs",
				cliHandler: "handleSubscriberImportLogsCommand",
				cliRender: "renderSubscriberImportLogs",
				invoker:
					"packages/operations/src/subscribers.ts#invokeGetSubscriberImportLogsOperation:function",
				action:
					"packages/operations/src/subscribers.ts#readSubscriberImportLogs:function",
				openapi: openapiImportLogsMethod,
			},
			{
				label: "import stop",
				cliHandler: "handleStopSubscriberImportCommand",
				cliRender: "renderStopSubscriberImport",
				invoker:
					"packages/operations/src/subscribers.ts#invokeStopSubscriberImportOperation:function",
				action:
					"packages/operations/src/subscribers.ts#stopSubscriberImport:function",
				openapi: openapiImportStopMethod,
			},
		],
	}),
	...resourceOperationContracts({
		resource: "template",
		cliModule:
			"apps/cli/src/commands/templates.ts#apps/cli/src/commands/templates.ts:module",
		cliTestModule:
			"apps/cli/tests/resources.test.ts#apps/cli/tests/resources.test.ts:module",
		mcpHandler: "packages/mcp/src/handlers/templates.ts#handleTemplatesTools:function",
		dispatcher:
			"packages/operations/src/templates.ts#invokeTemplateOperationByMcpName:function",
		operationTestModule:
			"packages/operations/tests/resources.test.ts#packages/operations/tests/resources.test.ts:module",
		mcpTestModule:
			"packages/mcp/tests/unit/resources.test.ts#packages/mcp/tests/unit/resources.test.ts:module",
		testAnchor: {
			invoker:
				"packages/operations/src/templates.ts#invokeUpdateTemplateOperation:function",
			action: "packages/operations/src/templates.ts#updateTemplate:function",
		},
		invokers: [
			{
				label: "list",
				cliHandler: "handleListTemplatesCommand",
				cliRender: "renderTemplates",
				invoker:
					"packages/operations/src/templates.ts#invokeGetTemplatesOperation:function",
				action: "packages/operations/src/templates.ts#listTemplates:function",
				openapi: openapiListMethod,
			},
			{
				label: "get",
				cliHandler: "handleGetTemplateCommand",
				cliRender: "renderTemplate",
				invoker:
					"packages/operations/src/templates.ts#invokeGetTemplateOperation:function",
				action: "packages/operations/src/templates.ts#getTemplate:function",
				openapi:
					"packages/openapi/src/client/crud.ts#CrudOperations.getById:method",
			},
			{
				label: "create",
				cliHandler: "handleCreateTemplateCommand",
				cliRender: "renderCreateTemplate",
				invoker:
					"packages/operations/src/templates.ts#invokeCreateTemplateOperation:function",
				action: "packages/operations/src/templates.ts#createTemplate:function",
				openapi: openapiCreateMethod,
			},
			{
				label: "update",
				cliHandler: "handleUpdateTemplateCommand",
				cliRender: "renderUpdateTemplate",
				invoker:
					"packages/operations/src/templates.ts#invokeUpdateTemplateOperation:function",
				action: "packages/operations/src/templates.ts#updateTemplate:function",
				openapi: openapiUpdateMethod,
			},
			{
				label: "preview",
				cliHandler: "handlePreviewTemplateCommand",
				cliRender: "renderPreviewTemplate",
				invoker:
					"packages/operations/src/templates.ts#invokePreviewTemplateOperation:function",
				action: "packages/operations/src/templates.ts#previewTemplate:function",
				openapi: openapiTemplatePreviewMethod,
			},
			{
				label: "delete",
				cliHandler: "handleDeleteTemplateCommand",
				cliRender: "renderDeleteTemplate",
				invoker:
					"packages/operations/src/templates.ts#invokeDeleteTemplateOperation:function",
				action: "packages/operations/src/templates.ts#deleteTemplate:function",
				openapi: openapiDeleteMethod,
			},
		],
	}),
	...resourceOperationContracts({
		resource: "media",
		cliModule:
			"apps/cli/src/commands/media.ts#apps/cli/src/commands/media.ts:module",
		cliTestModule:
			"apps/cli/tests/resources.test.ts#apps/cli/tests/resources.test.ts:module",
		mcpHandler: "packages/mcp/src/handlers/media.ts#handleMediaTools:function",
		dispatcher:
			"packages/operations/src/media.ts#invokeMediaOperationByMcpName:function",
		operationTestModule:
			"packages/operations/tests/resources.test.ts#packages/operations/tests/resources.test.ts:module",
		mcpTestModule:
			"packages/mcp/tests/unit/resources.test.ts#packages/mcp/tests/unit/resources.test.ts:module",
		testAnchor: {
			invoker:
				"packages/operations/src/media.ts#invokeGetMediaOperation:function",
			action: "packages/operations/src/media.ts#listMedia:function",
		},
		invokers: [
			{
				label: "list",
				cliHandler: "handleListMediaCommand",
				cliRender: "renderMedia",
				invoker:
					"packages/operations/src/media.ts#invokeGetMediaOperation:function",
				action: "packages/operations/src/media.ts#listMedia:function",
				openapi: openapiMediaListMethod,
			},
			{
				label: "get",
				cliHandler: "handleGetMediaFileCommand",
				cliRender: "renderMediaFile",
				invoker:
					"packages/operations/src/media.ts#invokeGetMediaFileOperation:function",
				action: "packages/operations/src/media.ts#getMediaFile:function",
				openapi: openapiMediaGetByIdMethod,
			},
			{
				label: "delete",
				cliHandler: "handleDeleteMediaCommand",
				cliRender: "renderDeleteMedia",
				invoker:
					"packages/operations/src/media.ts#invokeDeleteMediaOperation:function",
				action:
					"packages/operations/src/media.ts#deleteMediaFile:function",
				openapi: openapiMediaDeleteByIdMethod,
			},
		],
	}),
	...resourceOperationContracts({
		resource: "dashboard",
		cliModule:
			"apps/cli/src/commands/dashboard.ts#apps/cli/src/commands/dashboard.ts:module",
		cliTestModule:
			"apps/cli/tests/dashboard.test.ts#apps/cli/tests/dashboard.test.ts:module",
		mcpHandler:
			"packages/mcp/src/handlers/dashboard.ts#handleDashboardTools:function",
		dispatcher:
			"packages/operations/src/dashboard.ts#invokeDashboardOperationByMcpName:function",
		operationTestModule:
			"packages/operations/tests/dashboard.test.ts#packages/operations/tests/dashboard.test.ts:module",
		mcpTestModule:
			"packages/mcp/tests/unit/dashboard.test.ts#packages/mcp/tests/unit/dashboard.test.ts:module",
		testAnchor: {
			invoker:
				"packages/operations/src/dashboard.ts#invokeGetDashboardCountsOperation:function",
			action:
				"packages/operations/src/dashboard.ts#readDashboardCounts:function",
		},
		invokers: [
			{
				label: "counts",
				cliHandler: "handleDashboardCountsCommand",
				cliRender: "renderDashboardCounts",
				invoker:
					"packages/operations/src/dashboard.ts#invokeGetDashboardCountsOperation:function",
				action:
					"packages/operations/src/dashboard.ts#readDashboardCounts:function",
				openapi: openapiDashboardCountsMethod,
			},
			{
				label: "charts",
				cliHandler: "handleDashboardChartsCommand",
				cliRender: "renderDashboardCharts",
				invoker:
					"packages/operations/src/dashboard.ts#invokeGetDashboardChartsOperation:function",
				action:
					"packages/operations/src/dashboard.ts#readDashboardCharts:function",
				openapi: openapiDashboardChartsMethod,
			},
		],
	}),
	...resourceOperationContracts({
		resource: "bounce",
		cliModule:
			"apps/cli/src/commands/bounces.ts#apps/cli/src/commands/bounces.ts:module",
		cliTestModule:
			"apps/cli/tests/bounces.test.ts#apps/cli/tests/bounces.test.ts:module",
		mcpHandler:
			"packages/mcp/src/handlers/bounces.ts#handleBouncesTools:function",
		dispatcher:
			"packages/operations/src/bounces.ts#invokeBouncesOperationByMcpName:function",
		operationTestModule:
			"packages/operations/tests/bounces.test.ts#packages/operations/tests/bounces.test.ts:module",
		mcpTestModule:
			"packages/mcp/tests/unit/bounces.test.ts#packages/mcp/tests/unit/bounces.test.ts:module",
		testAnchor: {
			invoker:
				"packages/operations/src/bounces.ts#invokeListBouncesOperation:function",
			action: "packages/operations/src/bounces.ts#listBounces:function",
		},
		invokers: [
			{
				label: "list",
				cliHandler: "handleListBouncesCommand",
				cliRender: "renderBounces",
				invoker:
					"packages/operations/src/bounces.ts#invokeListBouncesOperation:function",
				action: "packages/operations/src/bounces.ts#listBounces:function",
				openapi: openapiBounceListMethod,
			},
			{
				label: "get",
				cliHandler: "handleGetBounceCommand",
				cliRender: "renderBounce",
				invoker:
					"packages/operations/src/bounces.ts#invokeGetBounceOperation:function",
				action: "packages/operations/src/bounces.ts#getBounce:function",
				openapi: openapiBounceGetByIdMethod,
			},
			{
				label: "delete",
				cliHandler: "handleDeleteBounceCommand",
				cliRender: "renderDeleteBounce",
				invoker:
					"packages/operations/src/bounces.ts#invokeDeleteBounceOperation:function",
				action: "packages/operations/src/bounces.ts#deleteBounce:function",
				openapi: openapiBounceDeleteByIdMethod,
			},
			{
				label: "prune",
				cliHandler: "handlePruneBouncesCommand",
				cliRender: "renderPruneBounces",
				invoker:
					"packages/operations/src/bounces.ts#invokePruneBouncesOperation:function",
				action: "packages/operations/src/bounces.ts#pruneBounces:function",
				openapi: openapiBounceDeleteByIdMethod,
			},
		],
	}),
];

const templateSetDefaultContracts: readonly CallPathContract[] = [
	{
		label: "CLI template default selection reaches the shared action",
		path: [
			"apps/cli/src/commands/templates.ts#handleSetDefaultTemplateCommand:function",
			"apps/cli/src/commands/templates.ts#renderSetDefaultTemplate:function",
			templateSetDefaultInvoker,
			templateSetDefaultAction,
			openapiTemplateSetDefaultMethod,
		],
	},
	{
		label: "MCP template default selection reaches the shared action",
		path: [
			mcpCallTool,
			"packages/mcp/src/handlers/templates.ts#handleTemplatesTools:function",
			"packages/operations/src/templates.ts#invokeTemplateOperationByMcpName:function",
			templateSetDefaultInvoker,
			templateSetDefaultAction,
			openapiTemplateSetDefaultMethod,
		],
	},
	{
		label: "CLI template default tests anchor the shared renderer",
		path: [
			"apps/cli/tests/resources.test.ts#apps/cli/tests/resources.test.ts:module",
			"apps/cli/src/commands/templates.ts#renderSetDefaultTemplate:function",
			templateSetDefaultInvoker,
		],
	},
	{
		label: "MCP template default tests anchor the shared dispatcher",
		path: [
			"packages/mcp/tests/unit/resources.test.ts#packages/mcp/tests/unit/resources.test.ts:module",
			"packages/mcp/src/handlers/templates.ts#handleTemplatesTools:function",
			"packages/operations/src/templates.ts#invokeTemplateOperationByMcpName:function",
			templateSetDefaultInvoker,
		],
	},
	{
		label: "Template default operation tests anchor the named action",
		path: [
			"packages/operations/tests/resources.test.ts#packages/operations/tests/resources.test.ts:module",
			templateSetDefaultInvoker,
			templateSetDefaultAction,
		],
	},
	{
		label: "OpenAPI template default tests anchor the named client method",
		path: [
			"packages/openapi/tests/templates-contract.test.ts#packages/openapi/tests/templates-contract.test.ts:module",
			openapiTemplateSetDefaultMethod,
		],
	},
	{
		label: "CLI/MCP template default parity E2E invokes the CLI subprocess runner",
		path: [cliMcpTemplateParityE2eTest, cliTemplateParityRunner],
	},
	{
		label: "CLI/MCP template default parity E2E reaches the shared MCP action",
		path: [
			cliMcpTemplateParityE2eTest,
			mcpTestClientCallTool,
			mcpCallTool,
			"packages/mcp/src/handlers/templates.ts#handleTemplatesTools:function",
			"packages/operations/src/templates.ts#invokeTemplateOperationByMcpName:function",
			templateSetDefaultInvoker,
			templateSetDefaultAction,
		],
	},
];

const cliCampaignsModulePath = "apps/cli/src/commands/campaigns.ts";
const campaignLifecycleDispatcher =
	"packages/operations/src/campaigns.ts#invokeCampaignOperationByMcpName:function";
const mcpCampaignsLifecycleHandler =
	"packages/mcp/src/handlers/campaigns.ts#handleCampaignsTools:variable";

interface CampaignLifecycleContractConfig {
	verb: string;
	cliHandler: string;
	cliRenderer: string;
	invoker: string;
	action: string;
}

function campaignLifecycleContractsFor(
	config: CampaignLifecycleContractConfig,
): CallPathContract[] {
	const label = `campaign ${config.verb}`;
	// Note: the MCP path stops at the shared action. Lifecycle methods
	// (updateStatus, getRunningStats) are factory-internal methods on the
	// anonymous intersection under `EnhancedListmonkClient.campaign`, so
	// they do not surface as graph nodes even after the CampaignOperations
	// interface extraction. Verifying the action → openapi edge would
	// require a separate anchor test that we deliberately scope out here.
	return [
		{
			label: `CLI ${label} reaches the shared action`,
			path: [
				`${cliCampaignsModulePath}#${config.cliHandler}:function`,
				`${cliCampaignsModulePath}#${config.cliRenderer}:function`,
				config.invoker,
				config.action,
			],
		},
		{
			label: `MCP ${label} reaches the shared action`,
			path: [
				mcpCallTool,
				mcpCampaignsLifecycleHandler,
				campaignLifecycleDispatcher,
				config.invoker,
				config.action,
			],
		},
		{
			label: `Operation tests anchor the ${label} invoker`,
			path: [
				"packages/operations/tests/resources.test.ts#packages/operations/tests/resources.test.ts:module",
				config.invoker,
				config.action,
			],
		},
		{
			label: `CLI ${label} tests anchor the shared renderer`,
			path: [
				"apps/cli/tests/resources.test.ts#apps/cli/tests/resources.test.ts:module",
				`${cliCampaignsModulePath}#${config.cliRenderer}:function`,
				config.invoker,
			],
		},
	];
}

const campaignLifecycleContracts: readonly CallPathContract[] = [
	...campaignLifecycleContractsFor({
		verb: "schedule",
		cliHandler: "handleScheduleCampaignCommand",
		cliRenderer: "renderScheduleCampaign",
		invoker:
			"packages/operations/src/campaigns.ts#invokeScheduleCampaignOperation:function",
		action:
			"packages/operations/src/campaigns.ts#scheduleCampaign:function",
	}),
	...campaignLifecycleContractsFor({
		verb: "start",
		cliHandler: "handleStartCampaignCommand",
		cliRenderer: "renderStartCampaign",
		invoker:
			"packages/operations/src/campaigns.ts#invokeStartCampaignOperation:function",
		action: "packages/operations/src/campaigns.ts#startCampaign:function",
	}),
	...campaignLifecycleContractsFor({
		verb: "pause",
		cliHandler: "handlePauseCampaignCommand",
		cliRenderer: "renderPauseCampaign",
		invoker:
			"packages/operations/src/campaigns.ts#invokePauseCampaignOperation:function",
		action: "packages/operations/src/campaigns.ts#pauseCampaign:function",
	}),
	...campaignLifecycleContractsFor({
		verb: "cancel",
		cliHandler: "handleCancelCampaignCommand",
		cliRenderer: "renderCancelCampaign",
		invoker:
			"packages/operations/src/campaigns.ts#invokeCancelCampaignOperation:function",
		action: "packages/operations/src/campaigns.ts#cancelCampaign:function",
	}),
	...campaignLifecycleContractsFor({
		verb: "clone",
		cliHandler: "handleCloneCampaignCommand",
		cliRenderer: "renderCloneCampaign",
		invoker:
			"packages/operations/src/campaigns.ts#invokeCloneCampaignOperation:function",
		action: "packages/operations/src/campaigns.ts#cloneCampaign:function",
	}),
	...campaignLifecycleContractsFor({
		verb: "stats",
		cliHandler: "handleGetCampaignStatsCommand",
		cliRenderer: "renderGetCampaignStats",
		invoker:
			"packages/operations/src/campaigns.ts#invokeGetCampaignStatsOperation:function",
			action:
				"packages/operations/src/campaigns.ts#getCampaignStats:function",
		}),
	];

const cliSubscribersModulePath = "apps/cli/src/commands/subscribers.ts";
const subscriberBulkDispatcher =
	"packages/operations/src/subscribers.ts#invokeSubscriberOperationByMcpName:function";
const mcpSubscribersBulkHandler =
	"packages/mcp/src/handlers/subscribers.ts#handleSubscribersTools:function";

interface SubscriberBulkContractConfig {
	verb: string;
	cliHandler: string;
	cliRenderer: string;
	invoker: string;
	action: string;
}

function subscriberBulkContractsFor(
	config: SubscriberBulkContractConfig,
): CallPathContract[] {
	const label = `subscriber ${config.verb}`;
	// As with the campaign lifecycle contracts, the MCP path stops at the
	// shared action. `manageLists` and `manageBlocklist` are factory-internal
	// methods on the SubscriberOperations interface and do not surface as
	// graph nodes.
	return [
		{
			label: `CLI ${label} reaches the shared action`,
			path: [
				`${cliSubscribersModulePath}#${config.cliHandler}:function`,
				`${cliSubscribersModulePath}#${config.cliRenderer}:function`,
				config.invoker,
				config.action,
			],
		},
		{
			label: `MCP ${label} reaches the shared action`,
			path: [
				mcpCallTool,
				mcpSubscribersBulkHandler,
				subscriberBulkDispatcher,
				config.invoker,
				config.action,
			],
		},
		{
			label: `Operation tests anchor the ${label} invoker`,
			path: [
				"packages/operations/tests/resources.test.ts#packages/operations/tests/resources.test.ts:module",
				config.invoker,
				config.action,
			],
		},
		{
			label: `CLI ${label} tests anchor the shared renderer`,
			path: [
				"apps/cli/tests/resources.test.ts#apps/cli/tests/resources.test.ts:module",
				`${cliSubscribersModulePath}#${config.cliRenderer}:function`,
				config.invoker,
			],
		},
	];
}

const subscriberBulkContracts: readonly CallPathContract[] = [
	...subscriberBulkContractsFor({
		verb: "add-to-lists",
		cliHandler: "handleAddSubscribersToListsCommand",
		cliRenderer: "renderAddSubscribersToLists",
		invoker:
			"packages/operations/src/subscribers.ts#invokeAddSubscribersToListsOperation:function",
		action:
			"packages/operations/src/subscribers.ts#addSubscribersToLists:function",
	}),
	...subscriberBulkContractsFor({
		verb: "remove-from-lists",
		cliHandler: "handleRemoveSubscribersFromListsCommand",
		cliRenderer: "renderRemoveSubscribersFromLists",
		invoker:
			"packages/operations/src/subscribers.ts#invokeRemoveSubscribersFromListsOperation:function",
		action:
			"packages/operations/src/subscribers.ts#removeSubscribersFromLists:function",
	}),
	...subscriberBulkContractsFor({
		verb: "blocklist",
		cliHandler: "handleBlocklistSubscribersCommand",
		cliRenderer: "renderBlocklistSubscribers",
		invoker:
			"packages/operations/src/subscribers.ts#invokeBlocklistSubscribersOperation:function",
		action:
			"packages/operations/src/subscribers.ts#blocklistSubscribers:function",
	}),
	...subscriberBulkContractsFor({
		verb: "unblocklist",
		cliHandler: "handleUnblocklistSubscribersCommand",
		cliRenderer: "renderUnblocklistSubscribers",
		invoker:
			"packages/operations/src/subscribers.ts#invokeUnblocklistSubscribersOperation:function",
		action:
			"packages/operations/src/subscribers.ts#unblocklistSubscribers:function",
		}),
	];

const cliMediaModulePath = "apps/cli/src/commands/media.ts";
const mediaUploadDispatcher =
	"packages/operations/src/media.ts#invokeMediaOperationByMcpName:function";
const mcpMediaUploadHandler =
	"packages/mcp/src/handlers/media.ts#handleMediaTools:function";

const mediaUploadContracts: readonly CallPathContract[] = [
	{
		label: "CLI media upload reaches the shared action",
		path: [
			`${cliMediaModulePath}#handleUploadMediaCommand:function`,
			`${cliMediaModulePath}#renderUploadMedia:function`,
			"packages/operations/src/media.ts#invokeUploadMediaOperation:function",
			"packages/operations/src/media.ts#uploadMediaFile:function",
		],
	},
	{
		label: "MCP media upload reaches the shared action",
		path: [
			mcpCallTool,
			mcpMediaUploadHandler,
			mediaUploadDispatcher,
			"packages/operations/src/media.ts#invokeUploadMediaOperation:function",
			"packages/operations/src/media.ts#uploadMediaFile:function",
		],
	},
	{
		label: "Operation tests anchor the media upload invoker",
		path: [
			"packages/operations/tests/resources.test.ts#packages/operations/tests/resources.test.ts:module",
			"packages/operations/src/media.ts#invokeUploadMediaOperation:function",
			"packages/operations/src/media.ts#uploadMediaFile:function",
		],
	},
	{
		label: "CLI media upload tests anchor the shared renderer",
		path: [
			"apps/cli/tests/resources.test.ts#apps/cli/tests/resources.test.ts:module",
			`${cliMediaModulePath}#renderUploadMedia:function`,
			"packages/operations/src/media.ts#invokeUploadMediaOperation:function",
		],
	},
];

const mediaParityContracts: readonly CallPathContract[] = [
	{
		label: "CLI/MCP media parity E2E invokes the CLI read runner",
		path: [cliMcpMediaParityE2eTest, cliMediaGetParityRunner],
	},
	{
		label: "CLI/MCP media parity E2E invokes the CLI delete runner",
		path: [cliMcpMediaParityE2eTest, cliMediaDeleteParityRunner],
	},
	{
		label: "CLI/MCP media parity E2E reaches the shared MCP read action",
		path: [
			cliMcpMediaParityE2eTest,
			mcpTestClientCallTool,
			mcpCallTool,
			"packages/mcp/src/handlers/media.ts#handleMediaTools:function",
			"packages/operations/src/media.ts#invokeMediaOperationByMcpName:function",
			mediaGetInvoker,
			mediaGetAction,
		],
	},
	{
		label: "CLI/MCP media parity E2E reaches the shared MCP delete action",
		path: [
			cliMcpMediaParityE2eTest,
			mcpTestClientCallTool,
			mcpCallTool,
			"packages/mcp/src/handlers/media.ts#handleMediaTools:function",
			"packages/operations/src/media.ts#invokeMediaOperationByMcpName:function",
			mediaDeleteInvoker,
			mediaDeleteAction,
		],
	},
];

const mcpHttpTransportContracts: readonly CallPathContract[] = [
	{
		label: "MCP HTTP tests instantiate the public server factory",
		path: [mcpHttpTransportTest, mcpHttpTestServerFactory, mcpServerFactory],
	},
	{
		label: "MCP HTTP tests exercise the public Hono application boundary",
		path: [mcpHttpTransportTest, mcpGetApp],
	},
	{
		label: "MCP HTTP tests exercise secure listener startup",
		path: [mcpHttpTransportTest, mcpListen, mcpSecureHttpBinding],
	},
	{
		label: "MCP server construction wires Host and Origin validation",
		path: [
			mcpConstructor,
			mcpSetupMiddleware,
			mcpValidateHttpRequest,
			mcpAllowedHttpOrigin,
		],
	},
	{
		label: "MCP server construction wires bearer authentication",
		path: [
			mcpConstructor,
			mcpSetupMiddleware,
			mcpValidateHttpRequest,
			mcpBearerTokenMatches,
		],
	},
	{
		label: "MCP server construction wires the Streamable HTTP handler",
		path: [mcpConstructor, mcpSetupRoutes, mcpHandleHttpRequest],
	},
];

export const architectureCallPaths: readonly CallPathContract[] = [
	{
		label: "CLI list command reaches the handwritten OpenAPI list method",
		path: [
			cliListHandler,
			cliListRenderer,
			getListsInvoker,
			listAction,
			openapiListMethod,
		],
	},
	{
		label: "CLI list command constructs the shared OpenAPI client",
		path: [
			cliListHandler,
			cliClientResolver,
			cliSessionResolver,
			openapiFactory,
		],
	},
	{
		label: "MCP list tool reaches the handwritten OpenAPI list method",
		path: [
			mcpCallTool,
			mcpListsHandler,
			listDispatcher,
			getListsInvoker,
			listAction,
			openapiListMethod,
		],
	},
	{
		label: "MCP server constructs the shared OpenAPI list client",
		path: [mcpConstructor, openapiFactory, openapiListFactory],
	},
	{
		label: "operations tests anchor the named list invoker",
		path: [
			"packages/operations/tests/lists.test.ts#packages/operations/tests/lists.test.ts:module",
			getListsInvoker,
			listAction,
		],
	},
	{
		label: "CLI tests anchor the shared list operation path",
		path: [
			"apps/cli/tests/lists.test.ts#apps/cli/tests/lists.test.ts:module",
			cliListRenderer,
			getListsInvoker,
		],
	},
	{
		label: "MCP tests anchor the shared list operation path",
		path: [
			"packages/mcp/tests/unit/lists.test.ts#packages/mcp/tests/unit/lists.test.ts:module",
			mcpListsHandler,
			listDispatcher,
		],
	},
	{
		label: "OpenAPI tests anchor the handwritten list client factory",
		path: [
			"packages/openapi/tests/client.test.ts#packages/openapi/tests/client.test.ts:module",
			openapiFactory,
			openapiListFactory,
			openapiCrudFactory,
		],
	},
	{
		label: "CLI transactional command reaches the OpenAPI send method",
		path: [
			cliTransactionalHandler,
			cliTransactionalRenderer,
			sendTransactionalInvoker,
			sendTransactionalAction,
			dispatchTransactionalToListmonk,
			openapiTransactionalMethod,
		],
	},
	{
		label: "MCP transactional tool reaches the OpenAPI send method",
		path: [
			mcpCallTool,
			mcpTransactionalHandler,
			transactionalDispatcher,
			sendTransactionalInvoker,
			sendTransactionalAction,
			dispatchTransactionalToListmonk,
			openapiTransactionalMethod,
		],
	},
	{
		label: "MCP transactional routing resolves the operation registry",
		path: [mcpCallTool, mcpTransactionalToolMatcher, transactionalLookup],
	},
	{
		label: "operations tests anchor the transactional send path",
		path: [
			"packages/operations/tests/transactional.test.ts#packages/operations/tests/transactional.test.ts:module",
			sendTransactionalInvoker,
			sendTransactionalAction,
		],
	},
	{
		label: "transactional wrapper serializes the payload for adapter hashing",
		path: [sendTransactionalAction, transactionalSerializePayload],
	},
	{
		label: "transactional wrapper commits terminal state through the store",
		path: [sendTransactionalAction, transactionalIdempotencyCommitBestEffort],
	},
	{
		label: "transactional wrapper releases claims on definitive thrown errors",
		path: [sendTransactionalAction, transactionalIdempotencyReleaseBestEffort],
	},
	{
		label: "common file-backed idempotency store reaches the JSON persistence layer",
		path: [commonTransactionalClaim, transactionalIdempotencyStoreUpdate],
	},
	{
		label: "common file-backed idempotency store commits terminal state atomically",
		path: [commonTransactionalCommit, transactionalIdempotencyStoreUpdate],
	},
	{
		label: "common file-backed idempotency store releases claims atomically",
		path: [commonTransactionalRelease, transactionalIdempotencyStoreUpdate],
	},
	{
		label: "common store factory wires claim into the store interface",
		path: [commonTransactionalStoreFactory, commonTransactionalClaim],
	},
	{
		label: "common store factory wires commit into the store interface",
		path: [commonTransactionalStoreFactory, commonTransactionalCommit],
	},
	{
		label: "common store factory wires release into the store interface",
		path: [commonTransactionalStoreFactory, commonTransactionalRelease],
	},
	{
		label: "common store tests anchor the file-backed claim contract",
		path: [transactionalIdempotencyStoreTest, commonTransactionalClaim],
	},
	{
		label: "common store tests anchor the file-backed commit contract",
		path: [transactionalIdempotencyStoreTest, commonTransactionalCommit],
	},
	{
		label: "common store tests anchor the file-backed release contract",
		path: [transactionalIdempotencyStoreTest, commonTransactionalRelease],
	},
	{
		label: "CLI tests anchor the transactional send path",
		path: [
			"apps/cli/tests/transactional.test.ts#apps/cli/tests/transactional.test.ts:module",
			cliTransactionalRenderer,
			sendTransactionalInvoker,
		],
	},
	{
		label: "MCP unit tests anchor the transactional send path",
		path: [
			"packages/mcp/tests/unit/transactional.test.ts#packages/mcp/tests/unit/transactional.test.ts:module",
			mcpTransactionalHandler,
			transactionalDispatcher,
		],
	},
	{
		label: "MCP E2E tests reach the transactional operation adapter",
		path: [
			mcpTransactionalE2eTest,
			mcpTestClientCallTool,
			mcpCallTool,
			mcpTransactionalHandler,
			transactionalDispatcher,
		],
	},
	{
		label: "MCP transactional E2E tests inspect Mailpit delivery",
		path: [mcpTransactionalE2eTest, findMailpitMessages, fetchMailpitJson],
	},
	{
		label: "Mailpit helper has a direct request-time URL regression test",
		path: [mailpitHelperRegressionTest, fetchMailpitJson],
	},
	{
		label: "Mailpit helper has a direct server-side search regression test",
		path: [
			mailpitHelperRegressionTest,
			findMailpitMessage,
			findMailpitMessages,
			fetchMailpitJson,
		],
	},
	{
		label: "Mailpit single-match helper delegates to the multi-match search",
		path: [findMailpitMessage, findMailpitMessages],
	},
	{
		label: "CLI/MCP transactional parity E2E invokes the CLI subprocess runner",
		path: [cliMcpTransactionalParityE2eTest, cliTransactionalParityRunner],
	},
	{
		label: "CLI/MCP transactional parity E2E reaches the MCP transactional adapter",
		path: [
			cliMcpTransactionalParityE2eTest,
			mcpTestClientCallTool,
			mcpCallTool,
			mcpTransactionalHandler,
			transactionalDispatcher,
		],
	},
	{
		label: "CLI/MCP transactional parity E2E inspects both Mailpit deliveries",
		path: [
			cliMcpTransactionalParityE2eTest,
			findMailpitMessage,
			findMailpitMessages,
			fetchMailpitJson,
		],
	},
	{
		label: "OpenAPI tests anchor the transactional send method",
		path: [
			"packages/openapi/tests/listmonk-6.2-contract.test.ts#packages/openapi/tests/listmonk-6.2-contract.test.ts:module",
			openapiTransactionalMethod,
		],
	},
	{
		label: "Operation catalog derives execution requirements from shared metadata",
		path: [
			sharedOperationCatalogSummary,
			sharedOperationCatalogEntrySummary,
			sharedOperationExecutionPolicy,
		],
	},
	{
		label: "Operation execution-policy tests anchor the policy derivation",
		path: [operationExecutionPolicyTest, sharedOperationExecutionPolicy],
	},
	{
		label: "Operation execution-policy tests anchor confirmation enforcement",
		path: [operationExecutionPolicyTest, sharedOperationConfirmation],
	},
	{
		label: "Operation execution-policy tests anchor effective dry-run resolution",
		path: [operationExecutionPolicyTest, sharedOperationEffectiveDryRun],
	},
	{
		label: "Operation audit tests anchor atomic audit persistence",
		path: [operationAuditTest, recordOperationAudit, updateJsonFileStore],
	},
	{
		label: "MCP execution-safety tests anchor registry policy resolution",
		path: [
			mcpOperationExecutionTest,
			mcpOperationExecutionResolver,
			sharedOperationExecutionPolicy,
		],
	},
	{
		label: "MCP execution-safety tests anchor registry lookup",
		path: [
			mcpOperationExecutionTest,
			mcpOperationExecutionResolver,
			sharedOperationCatalogLookup,
		],
	},
	{
		label: "MCP central boundary resolves execution metadata before dispatch",
		path: [mcpCallTool, mcpOperationExecutionResolver],
	},
	{
		label: "MCP execution resolver applies shared dry-run defaults",
		path: [
			mcpOperationExecutionTest,
			mcpOperationExecutionResolver,
			sharedOperationEffectiveDryRun,
		],
	},
	{
		label: "MCP central boundary rejects unsupported dry runs",
		path: [mcpCallTool, mcpOperationDryRunAssertion],
	},
	{
		label: "MCP central boundary enforces shared operation confirmation",
		path: [mcpCallTool, sharedOperationConfirmation],
	},
	{
		label: "MCP central boundary writes started and blocked audit events atomically",
		path: [
			mcpCallTool,
			mcpOperationAuditRecorder,
			recordOperationAuditWithLifecycle,
			recordOperationAudit,
			updateJsonFileStore,
		],
	},
	{
		label: "MCP completion writes terminal audit events atomically",
		path: [
			mcpCallTool,
			mcpOperationExecutionCompleter,
			mcpOperationAuditRecorder,
			recordOperationAuditWithLifecycle,
			recordOperationAudit,
			updateJsonFileStore,
		],
	},
	{
		label: "MCP audited operations project typed lifecycle events",
		path: [
			mcpCallTool,
			mcpOperationAuditRecorder,
			recordOperationAuditWithLifecycle,
			enqueueOperationLifecycleEvent,
		],
	},
	{
		label: "MCP completion projects successful domain lifecycle events",
		path: [
			mcpCallTool,
			mcpOperationExecutionCompleter,
			enqueueSuccessfulOperationLifecycleEvents,
			projectSuccessfulOperationLifecycleEvents,
		],
	},
	{
		label: "MCP execution-safety tests exercise the central enforcement boundary",
		path: [
			mcpOperationExecutionTest,
			mcpCallTool,
			mcpOperationExecutionResolver,
		],
	},
	{
		label: "CLI command adapter enters the shared execution-safety boundary",
		path: [cliDefineCommand, cliOperationExecutor],
	},
	{
		label: "CLI command tests exercise configured execution safety",
		path: [cliCommandAdapterTest, cliDefineCommand, cliOperationExecutor],
	},
	{
		label: "Interactive A/B creation enters the shared execution-safety boundary",
		path: [cliAbTestModule, cliOperationExecutor],
	},
	{
		label: "CLI execution-safety tests anchor registry policy resolution",
		path: [
			cliOperationExecutionTest,
			cliOperationExecutionResolver,
			sharedOperationExecutionPolicy,
		],
	},
	{
		label: "CLI execution resolver applies shared dry-run defaults",
		path: [
			cliOperationExecutionTest,
			cliOperationExecutionResolver,
			sharedOperationEffectiveDryRun,
		],
	},
	{
		label: "CLI execution boundary enforces shared operation confirmation",
		path: [cliOperationExecutor, sharedOperationConfirmation],
	},
	{
		label: "CLI execution boundary writes audit events atomically",
		path: [
			cliOperationExecutor,
			cliOperationAuditRecorder,
			recordOperationAuditWithLifecycle,
			recordOperationAudit,
			updateJsonFileStore,
		],
	},
	{
		label: "CLI audited operations project typed lifecycle events",
		path: [
			cliOperationExecutor,
			cliOperationAuditRecorder,
			recordOperationAuditWithLifecycle,
			enqueueOperationLifecycleEvent,
		],
	},
	{
		label: "CLI completion projects successful domain lifecycle events",
		path: [
			cliOperationExecutor,
			enqueueSuccessfulOperationLifecycleEvents,
			projectSuccessfulOperationLifecycleEvents,
		],
	},
	{
		label: "Domain lifecycle tests anchor the typed projection",
		path: [
			domainLifecycleProjectionTest,
			projectSuccessfulOperationLifecycleEvents,
		],
	},
	{
		label: "CLI execution-safety tests exercise the central enforcement boundary",
		path: [cliOperationExecutionTest, cliOperationExecutor],
	},
	...listInvokerContracts,
	...cliListMutationContracts,
	...resourceCrudContracts,
	...templateSetDefaultContracts,
	...campaignLifecycleContracts,
	...subscriberBulkContracts,
	...mediaUploadContracts,
	...mediaParityContracts,
	...mcpHttpTransportContracts,
	...opsOperationContracts,
	...abTestOperationContracts,
	...abTestTestContracts,
	...operationCatalogContracts,
];

export function assertArchitectureCallPaths(
	graph: GraphDump,
	contracts: readonly CallPathContract[] = architectureCallPaths,
): void {
	const nodeIds = new Set(graph.nodes.map((node) => node.id));
	const callEdges = new Set(
		graph.edges
			.filter((edge) => edge.kind === "calls")
			.map((edge) => `${edge.from}\0${edge.to}`),
	);
	const failures: string[] = [];

	for (const contract of contracts) {
		const missingNodes = new Set(
			contract.path.filter((nodeId) => !nodeIds.has(nodeId)),
		);
		for (const nodeId of missingNodes) {
			failures.push(`${contract.label}: missing node ${nodeId}`);
		}
		for (let index = 0; index < contract.path.length - 1; index += 1) {
			const from = contract.path[index];
			const to = contract.path[index + 1];
			if (
				from !== undefined &&
				to !== undefined &&
				!missingNodes.has(from) &&
				!missingNodes.has(to) &&
				!callEdges.has(`${from}\0${to}`)
			) {
				failures.push(`${contract.label}: missing call edge ${from} -> ${to}`);
			}
		}
	}

	if (failures.length > 0) {
		throw new Error(
			`Main graph architecture contract failed:\n${failures
				.map((failure) => `- ${failure}`)
				.join("\n")}`,
		);
	}
}

export function countArchitectureCallEdges(
	contracts: readonly CallPathContract[] = architectureCallPaths,
): number {
	return contracts.reduce(
		(total, contract) => total + Math.max(0, contract.path.length - 1),
		0,
	);
}

if (import.meta.main) {
	const graph = (await Bun.stdin.json()) as GraphDump;
	assertArchitectureCallPaths(graph);
	console.log(
		`Main graph preserves ${architectureCallPaths.length} architecture paths across ${countArchitectureCallEdges()} direct call edges.`,
	);
}
