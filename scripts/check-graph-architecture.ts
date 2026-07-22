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
const openapiTransactionalMethod =
	"packages/openapi/src/client/contracts.ts#TransactionalOperations.send:method";
const mcpTestClientCallTool =
	"packages/mcp/tests/mcp-helper.ts#MCPTestClient.callTool:method";
const mcpTransactionalE2eTest =
	"packages/mcp/tests/e2e/transactional.test.ts#packages/mcp/tests/e2e/transactional.test.ts:module";
const findMailpitMessage =
	"packages/mcp/tests/e2e/transactional.test.ts#findMessage:function";
const fetchMailpitJson =
	"packages/mcp/tests/e2e/transactional.test.ts#fetchMailpitJson:function";

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

const abTestOperationContracts: readonly CallPathContract[] = [
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
].flatMap(([label, cliAdapter, invoker, executor]) => [
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
]);

const abTestTestContracts: readonly CallPathContract[] = [
	{
		label: "A/B operation tests anchor the shared list invoker",
		path: [
			"packages/abtest/tests/operations.test.ts#packages/abtest/tests/operations.test.ts:module",
			"packages/abtest/src/operations.ts#invokeListAbTestsOperation:function",
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
		resource: "subscriber",
		cliModule:
			"apps/cli/src/commands/subscribers.ts#apps/cli/src/commands/subscribers.ts:module",
		cliTestModule:
			"apps/cli/tests/resources.test.ts#apps/cli/tests/resources.test.ts:module",
		mcpHandler: "packages/mcp/src/handlers/subscribers.ts#handleSubscribersTools:function",
		dispatcher:
			"packages/operations/src/subscribers.ts#invokeSubscriberOperationByMcpName:function",
		operationTestModule:
			"packages/operations/tests/resources.test.ts#packages/operations/tests/resources.test.ts:module",
		mcpTestModule:
			"packages/mcp/tests/unit/resources.test.ts#packages/mcp/tests/unit/resources.test.ts:module",
		testAnchor: {
			invoker:
				"packages/operations/src/subscribers.ts#invokeCreateSubscriberOperation:function",
			action:
				"packages/operations/src/subscribers.ts#createSubscriber:function",
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
		path: [mcpTransactionalE2eTest, findMailpitMessage, fetchMailpitJson],
	},
	{
		label: "OpenAPI tests anchor the transactional send method",
		path: [
			"packages/openapi/tests/listmonk-6.2-contract.test.ts#packages/openapi/tests/listmonk-6.2-contract.test.ts:module",
			openapiTransactionalMethod,
		],
	},
	...listInvokerContracts,
	...cliListMutationContracts,
	...resourceCrudContracts,
	...opsOperationContracts,
	...abTestOperationContracts,
	...abTestTestContracts,
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
