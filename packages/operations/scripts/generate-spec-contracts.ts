import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import typia from "typia";
import type {
	CampaignCollectionOutput,
	CampaignGetInput,
	CampaignGetOutput,
	CampaignListInput,
	CampaignLifecycleInput,
	CampaignLifecycleOutput,
	CampaignPreflightInput,
	CampaignPreflightOutput,
	CampaignScheduleInput,
	CampaignScheduleOutput,
	CampaignStatsOutput,
	ControlCapabilitiesOutput,
	ControlPrimeInput,
	ControlPrimeOutput,
	ControlStatusInput,
	ControlStatusOutput,
	DashboardCountsOutput,
	DashboardChartsOutput,
	DeliverabilityDnsCheckOutput,
	DeliverabilityDoctorOutput,
	EmptyInput,
	MediaCollectionOutput,
	MediaRecord,
	PaginationInput,
	PlaybookGetInput,
	PlaybookGetOutput,
	PlaybookListOutput,
	ProviderIdInput,
	ProviderListInput,
	ProviderListOutput,
	ProviderQuotaOutput,
	ProviderStatusOutput,
	ProviderTestOutput,
	ProviderWebhookStatusInput,
	ProviderWebhookStatusOutput,
	ResourceIdInput,
	SpecDescribeInput,
	SpecDescribeOutput,
	SpecSearchInput,
	SpecSearchOutput,
	SequenceCreateInput,
	SequenceCreateOutput,
	SequenceEnrollOutput,
	SequenceUpdateOutput,
	SequenceDefinitionOutput,
	SequenceDeleteOutput,
	SequenceEnrollInput,
	SequenceEnrollmentGetInput,
	SequenceEnrollmentListInput,
	SequenceEnrollmentListOutput,
	SequenceEnrollmentOutput,
	SequenceIdInput,
	SequenceListInput,
	SequenceListOutput,
	SequenceReconcileInput,
	SequenceReconcileOutput,
	SequenceStatusInput,
	SequenceStatusOutput,
	SequenceTickInput,
	SequenceTickOutput,
	SequenceUpdateInput,
	SequenceValidateInput,
	SequenceValidateOutput,
	SubscriberBlocklistInput,
	SubscriberBulkOutput,
	SubscriberCollectionOutput,
	SubscriberListCollectionOutput,
	SubscriberListInput,
	SubscriberListRecord,
	SubscriberCreateOutput,
	SubscriberRecord,
	TemplateCollectionOutput,
	TemplateCreateInput,
	TemplateCreateOutput,
	TemplateDeleteOutput,
	TemplateListInput,
	TemplateRecord,
	TemplateSetDefaultOutput,
	TemplatePreviewInput,
	TemplatePreviewOutput,
	TemplateUpdateInput,
	TransactionalSendInput,
	TransactionalSendOutput,
	WebhookCreateInput,
	WebhookCreateOutput,
	WebhookDeleteInput,
	WebhookDeleteOutput,
	WebhookCircuitResetInput,
	WebhookCircuitResetOutput,
	WebhookDeliveryListInput,
	WebhookDeliveryListOutput,
	WebhookDeliveryRetryInput,
	WebhookDeliveryRetryOutput,
	WebhookDlqListInput,
	WebhookDlqListOutput,
	WebhookDlqReplayInput,
	WebhookDlqReplayOutput,
	WebhookDispatchInput,
	WebhookDispatchOutput,
	WebhookListInput,
	WebhookListOutput,
	WebhookInboundIngestInput,
	WebhookInboundIngestOutput,
	WebhookPruneInput,
	WebhookPruneOutput,
	WebhookReconcileInput,
	WebhookReconcileOutput,
	WebhookTestInput,
	WebhookTestOutput,
	WebhookTickInput,
	WebhookTickOutput,
	WebhookRuntimeStatusInput,
	WebhookRuntimeStatusOutput,
	WebhookUpdateInput,
	WebhookUpdateOutput,
	UserRoleManifestReconcileInput,
	UserRoleManifestReconcileOutput,
	TemplateManifestReconcileInput,
	TemplateManifestReconcileOutput,
	ListCreateInput,
	ListCreateOutput,
	ListUpdateInput,
	ListDeleteInput,
	ListDeleteOutput,
	SubscriberCreateInput,
	SubscriberUpdateInput,
	SubscriberDeleteInput,
	SubscriberDeleteOutput,
	CampaignCreateInput,
	CampaignCreateOutput,
	CampaignAnalyticsInput,
	CampaignAnalyticsOutput,
	CampaignPreviewInput,
	CampaignPreviewOutput,
	CampaignTestInput,
	CampaignTestOutput,
	CampaignUpdateInput,
	CampaignDeleteInput,
	CampaignDeleteOutput,
	MediaUploadInput,
	MediaUploadOutput,
	MediaDeleteInput,
	MediaDeleteOutput,
	CampaignCloneInput,
	CampaignCloneOutput,
	SubscriberBulkListsInput,
	SubscriberBulkBlocklistInput,
	SegmentDriftInput,
	SegmentDriftOutput,
	DailyDigestInput,
	DailyDigestOutput,
	DeliverabilityGuardInput,
	DeliverabilityGuardOutput,
	SubscriberHygieneInput,
	SubscriberImportStartInput,
	SubscriberImportSessionOutput,
	SubscriberImportLogsOutput,
	SubscriberHygieneOutput,
	TemplateRegistrySyncInput,
	TemplateRegistrySyncOutput,
	TemplateRegistryHistoryOutput,
	TemplateIdInput,
	TemplatePromoteInput,
	TemplatePromoteOutput,
	TemplateRollbackInput,
	TemplateRollbackOutput,
	AbTestListInput,
	AbTestListOutput,
	AbTestIdInput,
	AbTestGetOutput,
	AbTestCreateInput,
	AbTestCreateOutput,
	AbTestAnalyzeInput,
	AbTestAnalysisOutput,
	AbTestRunInput,
	AbTestTickInput,
	AbTestTickOutput,
	AbTestReconcileInput,
	AbTestReconcileOutput,
	AbTestRecommendSampleSizeInput,
	AbTestRecommendOutput,
	AbTestExportAssignmentInput,
	AbTestExportOutput,
	AbTestDeleteOutput,
	AbTestDeployWinnerOutput,
	BounceCollectionOutput,
	BounceDeleteOutput,
	BounceIdInput,
	BounceListInput,
	BouncePruneInput,
	BouncePruneOutput,
	BounceRecord,
} from "./spec-contracts";
import type { NormalizedContractSchema } from "../src/specs/json";
import { stableValue } from "../src/specs/stable-json.js";

const outputPath = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../src/specs/generated/contract-schemas.json",
);
const checkOnly = process.argv.includes("--check");

function stableRecord(
	value: unknown,
	label: string,
): Readonly<Record<string, unknown>> {
	const stable = stableValue(value);
	if (typeof stable !== "object" || stable === null || Array.isArray(stable)) {
		throw new TypeError(
			`Typia generated non-object ${label}: ${JSON.stringify(stable)}`,
		);
	}
	return stable as Readonly<Record<string, unknown>>;
}

function contractSchema(generated: {
	schema: unknown;
	components: unknown;
}): NormalizedContractSchema {
	return {
		dialect: "openapi-3.1",
		stage: "normalized",
		source: "typescript",
		schema: stableRecord(generated.schema, "contract schema"),
		components: stableRecord(generated.components, "contract components"),
	};
}

function objectRecord(
	value: unknown,
	label: string,
): Readonly<Record<string, unknown>> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new TypeError(`Typia generated non-object ${label}`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function inclusiveUnionSchema(
	schema: Readonly<Record<string, unknown>>,
	label: string,
): Readonly<Record<string, unknown>> {
	const branches = schema["oneOf"];
	if (!Array.isArray(branches) || branches.length === 0) {
		throw new TypeError(`Typia generated ${label} without oneOf branches`);
	}
	const normalized = { ...schema };
	delete normalized["oneOf"];
	return { ...normalized, anyOf: branches };
}

/**
 * Typia projects TypeScript unions as JSON Schema `oneOf`. At-least-one-field
 * update unions overlap when callers provide multiple fields, so their JSON
 * Schema projection must use inclusive `anyOf` semantics instead.
 */
function inclusiveUnionContractSchema(
	generated: { schema: unknown; components: unknown },
	componentName: string,
): NormalizedContractSchema {
	const contract = contractSchema(generated);
	const schemas = objectRecord(
		contract.components["schemas"],
		"contract components.schemas",
	);
	const component = objectRecord(
		schemas[componentName],
		`contract component ${componentName}`,
	);
	return {
		...contract,
		schema: inclusiveUnionSchema(contract.schema, "contract schema"),
		components: {
			...contract.components,
			schemas: {
				...schemas,
				[componentName]: inclusiveUnionSchema(
					component,
					`contract component ${componentName}`,
				),
			},
		},
	};
}

// Keep this map aligned with the normalized contract types above and the
// typed accessors in ../src/specs/contract-schemas.ts.
const contracts = {
	campaignGetInputContract: contractSchema(
		typia.json.schema<CampaignGetInput>(),
	),
	campaignGetOutputContract: contractSchema(
		typia.json.schema<CampaignGetOutput>(),
	),
	paginationInputContract: contractSchema(typia.json.schema<PaginationInput>()),
	resourceIdInputContract: contractSchema(typia.json.schema<ResourceIdInput>()),
	subscriberListRecordContract: contractSchema(
		typia.json.schema<SubscriberListRecord>(),
	),
	subscriberListCollectionOutputContract: contractSchema(
		typia.json.schema<SubscriberListCollectionOutput>(),
	),
	subscriberRecordContract: contractSchema(
		typia.json.schema<SubscriberRecord>(),
	),
	subscriberListInputContract: contractSchema(
		typia.json.schema<SubscriberListInput>(),
	),
	subscriberCollectionOutputContract: contractSchema(
		typia.json.schema<SubscriberCollectionOutput>(),
	),
	campaignListInputContract: contractSchema(
		typia.json.schema<CampaignListInput>(),
	),
	campaignCollectionOutputContract: contractSchema(
		typia.json.schema<CampaignCollectionOutput>(),
	),
	campaignStatsOutputContract: contractSchema(
		typia.json.schema<CampaignStatsOutput>(),
	),
	templateRecordContract: contractSchema(typia.json.schema<TemplateRecord>()),
	templateCreateInputContract: contractSchema(
		typia.json.schema<TemplateCreateInput>(),
	),
	templateCreateOutputContract: contractSchema(
		typia.json.schema<TemplateCreateOutput>(),
	),
	templateUpdateInputContract: inclusiveUnionContractSchema(
		typia.json.schema<TemplateUpdateInput>(),
		"TemplateUpdateInput",
	),
	templateDeleteOutputContract: contractSchema(
		typia.json.schema<TemplateDeleteOutput>(),
	),
	templateSetDefaultOutputContract: contractSchema(
		typia.json.schema<TemplateSetDefaultOutput>(),
	),
	templateListInputContract: contractSchema(
		typia.json.schema<TemplateListInput>(),
	),
	templateCollectionOutputContract: contractSchema(
		typia.json.schema<TemplateCollectionOutput>(),
	),
	mediaRecordContract: contractSchema(typia.json.schema<MediaRecord>()),
	mediaCollectionOutputContract: contractSchema(
		typia.json.schema<MediaCollectionOutput>(),
	),
	bounceRecordContract: contractSchema(typia.json.schema<BounceRecord>()),
	bounceCollectionOutputContract: contractSchema(
		typia.json.schema<BounceCollectionOutput>(),
	),
	bounceListInputContract: contractSchema(typia.json.schema<BounceListInput>()),
	bounceIdInputContract: contractSchema(typia.json.schema<BounceIdInput>()),
	bounceDeleteOutputContract: contractSchema(
		typia.json.schema<BounceDeleteOutput>(),
	),
	bouncePruneInputContract: contractSchema(
		typia.json.schema<BouncePruneInput>(),
	),
	subscriberImportStartInputContract: contractSchema(
		typia.json.schema<SubscriberImportStartInput>(),
	),
	subscriberImportStartOutputContract: contractSchema(
		typia.json.schema<SubscriberImportSessionOutput>(),
	),
	subscriberImportStatusOutputContract: contractSchema(
		typia.json.schema<SubscriberImportSessionOutput>(),
	),
	subscriberImportStopOutputContract: contractSchema(
		typia.json.schema<SubscriberImportSessionOutput>(),
	),
	subscriberImportLogsOutputContract: contractSchema(
		typia.json.schema<SubscriberImportLogsOutput>(),
	),
	templatePreviewInputContract: contractSchema(
		typia.json.schema<TemplatePreviewInput>(),
	),
	templatePreviewOutputContract: contractSchema(
		typia.json.schema<TemplatePreviewOutput>(),
	),
	dashboardCountsOutputContract: contractSchema(
		typia.json.schema<DashboardCountsOutput>(),
	),
	dashboardChartsOutputContract: contractSchema(
		typia.json.schema<DashboardChartsOutput>(),
	),
	bouncePruneOutputContract: contractSchema(
		typia.json.schema<BouncePruneOutput>(),
	),
	campaignLifecycleInputContract: contractSchema(
		typia.json.schema<CampaignLifecycleInput>(),
	),
	campaignLifecycleOutputContract: contractSchema(
		typia.json.schema<CampaignLifecycleOutput>(),
	),
	campaignPreflightInputContract: contractSchema(
		typia.json.schema<CampaignPreflightInput>(),
	),
	campaignPreflightOutputContract: contractSchema(
		typia.json.schema<CampaignPreflightOutput>(),
	),
	campaignScheduleInputContract: contractSchema(
		typia.json.schema<CampaignScheduleInput>(),
	),
	campaignScheduleOutputContract: contractSchema(
		typia.json.schema<CampaignScheduleOutput>(),
	),
	subscriberBlocklistInputContract: contractSchema(
		typia.json.schema<SubscriberBlocklistInput>(),
	),
	subscriberBulkOutputContract: contractSchema(
		typia.json.schema<SubscriberBulkOutput>(),
	),
	transactionalSendInputContract: contractSchema(
		typia.json.schema<TransactionalSendInput>(),
	),
	transactionalSendOutputContract: contractSchema(
		typia.json.schema<TransactionalSendOutput>(),
	),
	sequenceValidateInputContract: contractSchema(
		typia.json.schema<SequenceValidateInput>(),
	),
	sequenceValidateOutputContract: contractSchema(
		typia.json.schema<SequenceValidateOutput>(),
	),
	sequenceCreateInputContract: contractSchema(
		typia.json.schema<SequenceCreateInput>(),
	),
	sequenceCreateOutputContract: contractSchema(
		typia.json.schema<SequenceCreateOutput>(),
	),
	sequenceDefinitionOutputContract: contractSchema(
		typia.json.schema<SequenceDefinitionOutput>(),
	),
	sequenceUpdateOutputContract: contractSchema(
		typia.json.schema<SequenceUpdateOutput>(),
	),
	sequenceUpdateInputContract: contractSchema(
		typia.json.schema<SequenceUpdateInput>(),
	),
	sequenceListInputContract: contractSchema(
		typia.json.schema<SequenceListInput>(),
	),
	sequenceListOutputContract: contractSchema(
		typia.json.schema<SequenceListOutput>(),
	),
	sequenceIdInputContract: contractSchema(typia.json.schema<SequenceIdInput>()),
	sequenceDeleteOutputContract: contractSchema(
		typia.json.schema<SequenceDeleteOutput>(),
	),
	sequenceEnrollOutputContract: contractSchema(
		typia.json.schema<SequenceEnrollOutput>(),
	),
	sequenceEnrollInputContract: contractSchema(
		typia.json.schema<SequenceEnrollInput>(),
	),
	sequenceEnrollmentOutputContract: contractSchema(
		typia.json.schema<SequenceEnrollmentOutput>(),
	),
	sequenceEnrollmentListInputContract: contractSchema(
		typia.json.schema<SequenceEnrollmentListInput>(),
	),
	sequenceEnrollmentListOutputContract: contractSchema(
		typia.json.schema<SequenceEnrollmentListOutput>(),
	),
	sequenceEnrollmentGetInputContract: contractSchema(
		typia.json.schema<SequenceEnrollmentGetInput>(),
	),
	sequenceTickInputContract: contractSchema(
		typia.json.schema<SequenceTickInput>(),
	),
	sequenceTickOutputContract: contractSchema(
		typia.json.schema<SequenceTickOutput>(),
	),
	sequenceReconcileInputContract: contractSchema(
		typia.json.schema<SequenceReconcileInput>(),
	),
	sequenceReconcileOutputContract: contractSchema(
		typia.json.schema<SequenceReconcileOutput>(),
	),
	sequenceStatusInputContract: contractSchema(
		typia.json.schema<SequenceStatusInput>(),
	),
	sequenceStatusOutputContract: contractSchema(
		typia.json.schema<SequenceStatusOutput>(),
	),
	specSearchInputContract: contractSchema(typia.json.schema<SpecSearchInput>()),
	specSearchOutputContract: contractSchema(
		typia.json.schema<SpecSearchOutput>(),
	),
	specDescribeInputContract: contractSchema(
		typia.json.schema<SpecDescribeInput>(),
	),
	specDescribeOutputContract: contractSchema(
		typia.json.schema<SpecDescribeOutput>(),
	),
	emptyInputContract: contractSchema(typia.json.schema<EmptyInput>()),
	playbookListOutputContract: contractSchema(
		typia.json.schema<PlaybookListOutput>(),
	),
	playbookGetInputContract: contractSchema(
		typia.json.schema<PlaybookGetInput>(),
	),
	playbookGetOutputContract: contractSchema(
		typia.json.schema<PlaybookGetOutput>(),
	),
	controlCapabilitiesOutputContract: contractSchema(
		typia.json.schema<ControlCapabilitiesOutput>(),
	),
	controlPrimeInputContract: contractSchema(
		typia.json.schema<ControlPrimeInput>(),
	),
	controlPrimeOutputContract: contractSchema(
		typia.json.schema<ControlPrimeOutput>(),
	),
	controlStatusInputContract: contractSchema(
		typia.json.schema<ControlStatusInput>(),
	),
	controlStatusOutputContract: contractSchema(
		typia.json.schema<ControlStatusOutput>(),
	),
	providerListInputContract: contractSchema(
		typia.json.schema<ProviderListInput>(),
	),
	providerListOutputContract: contractSchema(
		typia.json.schema<ProviderListOutput>(),
	),
	providerIdInputContract: contractSchema(typia.json.schema<ProviderIdInput>()),
	providerStatusOutputContract: contractSchema(
		typia.json.schema<ProviderStatusOutput>(),
	),
	providerTestOutputContract: contractSchema(
		typia.json.schema<ProviderTestOutput>(),
	),
	providerQuotaOutputContract: contractSchema(
		typia.json.schema<ProviderQuotaOutput>(),
	),
	providerWebhookStatusInputContract: contractSchema(
		typia.json.schema<ProviderWebhookStatusInput>(),
	),
	providerWebhookStatusOutputContract: contractSchema(
		typia.json.schema<ProviderWebhookStatusOutput>(),
	),
	deliverabilityDnsCheckOutputContract: contractSchema(
		typia.json.schema<DeliverabilityDnsCheckOutput>(),
	),
	deliverabilityDoctorOutputContract: contractSchema(
		typia.json.schema<DeliverabilityDoctorOutput>(),
	),
	webhookListInputContract: contractSchema(
		typia.json.schema<WebhookListInput>(),
	),
	webhookListOutputContract: contractSchema(
		typia.json.schema<WebhookListOutput>(),
	),
	webhookCreateInputContract: contractSchema(
		typia.json.schema<WebhookCreateInput>(),
	),
	webhookCreateOutputContract: contractSchema(
		typia.json.schema<WebhookCreateOutput>(),
	),
	webhookUpdateInputContract: contractSchema(
		typia.json.schema<WebhookUpdateInput>(),
	),
	webhookUpdateOutputContract: contractSchema(
		typia.json.schema<WebhookUpdateOutput>(),
	),
	webhookDeleteInputContract: contractSchema(
		typia.json.schema<WebhookDeleteInput>(),
	),
	webhookDeleteOutputContract: contractSchema(
		typia.json.schema<WebhookDeleteOutput>(),
	),
	webhookTestInputContract: contractSchema(
		typia.json.schema<WebhookTestInput>(),
	),
	webhookTestOutputContract: contractSchema(
		typia.json.schema<WebhookTestOutput>(),
	),
	webhookDispatchInputContract: contractSchema(
		typia.json.schema<WebhookDispatchInput>(),
	),
	webhookDispatchOutputContract: contractSchema(
		typia.json.schema<WebhookDispatchOutput>(),
	),
	webhookDeliveryListInputContract: contractSchema(
		typia.json.schema<WebhookDeliveryListInput>(),
	),
	webhookDeliveryListOutputContract: contractSchema(
		typia.json.schema<WebhookDeliveryListOutput>(),
	),
	webhookDeliveryRetryInputContract: contractSchema(
		typia.json.schema<WebhookDeliveryRetryInput>(),
	),
	webhookDeliveryRetryOutputContract: contractSchema(
		typia.json.schema<WebhookDeliveryRetryOutput>(),
	),
	webhookReconcileInputContract: contractSchema(
		typia.json.schema<WebhookReconcileInput>(),
	),
	webhookReconcileOutputContract: contractSchema(
		typia.json.schema<WebhookReconcileOutput>(),
	),
	webhookPruneInputContract: contractSchema(
		typia.json.schema<WebhookPruneInput>(),
	),
	webhookPruneOutputContract: contractSchema(
		typia.json.schema<WebhookPruneOutput>(),
	),
	webhookTickInputContract: contractSchema(
		typia.json.schema<WebhookTickInput>(),
	),
	webhookTickOutputContract: contractSchema(
		typia.json.schema<WebhookTickOutput>(),
	),
	webhookRuntimeStatusInputContract: contractSchema(
		typia.json.schema<WebhookRuntimeStatusInput>(),
	),
	webhookRuntimeStatusOutputContract: contractSchema(
		typia.json.schema<WebhookRuntimeStatusOutput>(),
	),
	webhookInboundIngestInputContract: contractSchema(
		typia.json.schema<WebhookInboundIngestInput>(),
	),
	webhookInboundIngestOutputContract: contractSchema(
		typia.json.schema<WebhookInboundIngestOutput>(),
	),
	webhookDlqListInputContract: contractSchema(
		typia.json.schema<WebhookDlqListInput>(),
	),
	webhookDlqListOutputContract: contractSchema(
		typia.json.schema<WebhookDlqListOutput>(),
	),
	webhookDlqReplayInputContract: contractSchema(
		typia.json.schema<WebhookDlqReplayInput>(),
	),
	webhookDlqReplayOutputContract: contractSchema(
		typia.json.schema<WebhookDlqReplayOutput>(),
	),
	webhookCircuitResetInputContract: contractSchema(
		typia.json.schema<WebhookCircuitResetInput>(),
	),
	webhookCircuitResetOutputContract: contractSchema(
		typia.json.schema<WebhookCircuitResetOutput>(),
	),
	userRoleManifestReconcileInputContract: contractSchema(
		typia.json.schema<UserRoleManifestReconcileInput>(),
	),
	userRoleManifestReconcileOutputContract: contractSchema(
		typia.json.schema<UserRoleManifestReconcileOutput>(),
	),
	templateManifestReconcileInputContract: contractSchema(
		typia.json.schema<TemplateManifestReconcileInput>(),
	),
	templateManifestReconcileOutputContract: contractSchema(
		typia.json.schema<TemplateManifestReconcileOutput>(),
	),
	listCreateInputContract: contractSchema(typia.json.schema<ListCreateInput>()),
	listCreateOutputContract: contractSchema(
		typia.json.schema<ListCreateOutput>(),
	),
	listUpdateInputContract: inclusiveUnionContractSchema(
		typia.json.schema<ListUpdateInput>(),
		"ListUpdateInput",
	),
	listDeleteInputContract: contractSchema(typia.json.schema<ListDeleteInput>()),
	listDeleteOutputContract: contractSchema(
		typia.json.schema<ListDeleteOutput>(),
	),
	subscriberCreateOutputContract: contractSchema(
		typia.json.schema<SubscriberCreateOutput>(),
	),
	subscriberCreateInputContract: contractSchema(
		typia.json.schema<SubscriberCreateInput>(),
	),
	subscriberUpdateInputContract: inclusiveUnionContractSchema(
		typia.json.schema<SubscriberUpdateInput>(),
		"SubscriberUpdateInput",
	),
	subscriberDeleteInputContract: contractSchema(
		typia.json.schema<SubscriberDeleteInput>(),
	),
	subscriberDeleteOutputContract: contractSchema(
		typia.json.schema<SubscriberDeleteOutput>(),
	),
	campaignCreateInputContract: contractSchema(
		typia.json.schema<CampaignCreateInput>(),
	),
	campaignCreateOutputContract: contractSchema(
		typia.json.schema<CampaignCreateOutput>(),
	),
	campaignUpdateInputContract: inclusiveUnionContractSchema(
		typia.json.schema<CampaignUpdateInput>(),
		"CampaignUpdateInput",
	),
	campaignDeleteInputContract: contractSchema(
		typia.json.schema<CampaignDeleteInput>(),
	),
	campaignDeleteOutputContract: contractSchema(
		typia.json.schema<CampaignDeleteOutput>(),
	),
	mediaUploadInputContract: contractSchema(
		typia.json.schema<MediaUploadInput>(),
	),
	mediaUploadOutputContract: contractSchema(
		typia.json.schema<MediaUploadOutput>(),
	),
	mediaDeleteInputContract: contractSchema(
		typia.json.schema<MediaDeleteInput>(),
	),
	mediaDeleteOutputContract: contractSchema(
		typia.json.schema<MediaDeleteOutput>(),
	),
	campaignCloneInputContract: contractSchema(
		typia.json.schema<CampaignCloneInput>(),
	),
	campaignCloneOutputContract: contractSchema(
		typia.json.schema<CampaignCloneOutput>(),
	),
	campaignAnalyticsInputContract: contractSchema(
		typia.json.schema<CampaignAnalyticsInput>(),
	),
	campaignAnalyticsOutputContract: contractSchema(
		typia.json.schema<CampaignAnalyticsOutput>(),
	),
	campaignPreviewInputContract: contractSchema(
		typia.json.schema<CampaignPreviewInput>(),
	),
	campaignPreviewOutputContract: contractSchema(
		typia.json.schema<CampaignPreviewOutput>(),
	),
	campaignTestInputContract: contractSchema(
		typia.json.schema<CampaignTestInput>(),
	),
	campaignTestOutputContract: contractSchema(
		typia.json.schema<CampaignTestOutput>(),
	),
	subscriberBulkListsInputContract: contractSchema(
		typia.json.schema<SubscriberBulkListsInput>(),
	),
	subscriberBulkBlocklistInputContract: contractSchema(
		typia.json.schema<SubscriberBulkBlocklistInput>(),
	),
	segmentDriftInputContract: contractSchema(
		typia.json.schema<SegmentDriftInput>(),
	),
	segmentDriftOutputContract: contractSchema(
		typia.json.schema<SegmentDriftOutput>(),
	),
	dailyDigestInputContract: contractSchema(
		typia.json.schema<DailyDigestInput>(),
	),
	dailyDigestOutputContract: contractSchema(
		typia.json.schema<DailyDigestOutput>(),
	),
	deliverabilityGuardInputContract: contractSchema(
		typia.json.schema<DeliverabilityGuardInput>(),
	),
	deliverabilityGuardOutputContract: contractSchema(
		typia.json.schema<DeliverabilityGuardOutput>(),
	),
	subscriberHygieneInputContract: contractSchema(
		typia.json.schema<SubscriberHygieneInput>(),
	),
	subscriberHygieneOutputContract: contractSchema(
		typia.json.schema<SubscriberHygieneOutput>(),
	),
	templateRegistrySyncInputContract: contractSchema(
		typia.json.schema<TemplateRegistrySyncInput>(),
	),
	templateRegistrySyncOutputContract: contractSchema(
		typia.json.schema<TemplateRegistrySyncOutput>(),
	),
	templateRegistryHistoryOutputContract: contractSchema(
		typia.json.schema<TemplateRegistryHistoryOutput>(),
	),
	templateIdInputContract: contractSchema(typia.json.schema<TemplateIdInput>()),
	templatePromoteInputContract: contractSchema(
		typia.json.schema<TemplatePromoteInput>(),
	),
	templateRollbackInputContract: contractSchema(
		typia.json.schema<TemplateRollbackInput>(),
	),
	templateRollbackOutputContract: contractSchema(
		typia.json.schema<TemplateRollbackOutput>(),
	),
	templatePromoteOutputContract: contractSchema(
		typia.json.schema<TemplatePromoteOutput>(),
	),
	abTestListInputContract: contractSchema(typia.json.schema<AbTestListInput>()),
	abTestListOutputContract: contractSchema(
		typia.json.schema<AbTestListOutput>(),
	),
	abTestIdInputContract: contractSchema(typia.json.schema<AbTestIdInput>()),
	abTestGetOutputContract: contractSchema(typia.json.schema<AbTestGetOutput>()),
	abTestCreateOutputContract: contractSchema(
		typia.json.schema<AbTestCreateOutput>(),
	),
	abTestCreateInputContract: contractSchema(
		typia.json.schema<AbTestCreateInput>(),
	),
	abTestAnalyzeInputContract: contractSchema(
		typia.json.schema<AbTestAnalyzeInput>(),
	),
	abTestAnalysisOutputContract: contractSchema(
		typia.json.schema<AbTestAnalysisOutput>(),
	),
	abTestRunInputContract: contractSchema(typia.json.schema<AbTestRunInput>()),
	abTestTickInputContract: contractSchema(typia.json.schema<AbTestTickInput>()),
	abTestTickOutputContract: contractSchema(
		typia.json.schema<AbTestTickOutput>(),
	),
	abTestReconcileInputContract: contractSchema(
		typia.json.schema<AbTestReconcileInput>(),
	),
	abTestReconcileOutputContract: contractSchema(
		typia.json.schema<AbTestReconcileOutput>(),
	),
	abTestRecommendSampleSizeInputContract: contractSchema(
		typia.json.schema<AbTestRecommendSampleSizeInput>(),
	),
	abTestRecommendOutputContract: contractSchema(
		typia.json.schema<AbTestRecommendOutput>(),
	),
	abTestExportAssignmentInputContract: contractSchema(
		typia.json.schema<AbTestExportAssignmentInput>(),
	),
	abTestExportOutputContract: contractSchema(
		typia.json.schema<AbTestExportOutput>(),
	),
	abTestDeleteOutputContract: contractSchema(
		typia.json.schema<AbTestDeleteOutput>(),
	),
	abTestDeployWinnerOutputContract: contractSchema(
		typia.json.schema<AbTestDeployWinnerOutput>(),
	),
} satisfies Record<string, NormalizedContractSchema>;

function renderContracts(): string {
	return `${JSON.stringify(stableValue(contracts), null, 2)}\n`;
}

const expected = renderContracts();
let current: string | undefined;
try {
	current = await readFile(outputPath, "utf8");
} catch {
	current = undefined;
}
if (checkOnly) {
	if (current !== expected) {
		throw new Error(
			"Generated contract schemas are stale. Run `bun run --cwd packages/operations generate:specs`.",
		);
	}
} else {
	await writeFile(outputPath, expected);
}
