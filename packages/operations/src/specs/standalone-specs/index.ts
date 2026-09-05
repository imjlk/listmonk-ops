export * from "./list-specs";
export * from "./subscriber-specs";
export * from "./system-specs";
export * from "./campaign-specs";
export * from "./dashboard-specs";
export * from "./template-specs";
export * from "./media-specs";
export * from "./bounces-specs";
export * from "./ops-specs";
export * from "./abtest-specs";

import {
	listsCreateOperationSpec,
	listsUpdateOperationSpec,
	listsDeleteOperationSpec,
} from "./list-specs";
import {
	subscribersCreateOperationSpec,
	subscribersUpdateOperationSpec,
	subscribersDeleteOperationSpec,
	subscribersAddToListsOperationSpec,
	subscribersRemoveFromListsOperationSpec,
	subscribersUnblocklistOperationSpec,
	subscribersImportStartOperationSpec,
	subscribersImportStatusOperationSpec,
	subscribersImportStopOperationSpec,
	subscribersImportLogsOperationSpec,
	subscribersExportOperationSpec,
} from "./subscriber-specs";
import {
	systemAboutOperationSpec,
	systemLogsOperationSpec,
} from "./system-specs";
import {
	dashboardCountsOperationSpec,
	dashboardChartsOperationSpec,
} from "./dashboard-specs";
import {
	campaignsCreateOperationSpec,
	campaignsUpdateOperationSpec,
	campaignsDeleteOperationSpec,
	campaignsPauseOperationSpec,
	campaignsCloneOperationSpec,
	campaignsPreviewOperationSpec,
	campaignsTestOperationSpec,
	campaignsAnalyticsOperationSpec,
} from "./campaign-specs";
import {
	templatesCreateOperationSpec,
	templatesUpdateOperationSpec,
	templatesDeleteOperationSpec,
	templatesSetDefaultOperationSpec,
	templatesReconcileOperationSpec,
	templatesPreviewOperationSpec,
} from "./template-specs";
import {
	mediaDeleteOperationSpec,
	mediaUploadOperationSpec,
} from "./media-specs";
import {
	bouncesListOperationSpec,
	bouncesGetOperationSpec,
	bouncesDeleteOperationSpec,
	bouncesPruneOperationSpec,
} from "./bounces-specs";
import {
	opsSegmentDriftOperationSpec,
	opsDailyDigestOperationSpec,
	opsDeliverabilityGuardOperationSpec,
	opsSubscriberHygieneOperationSpec,
	opsTemplateRegistrySyncOperationSpec,
	opsTemplateRegistryHistoryOperationSpec,
	opsTemplateRegistryPromoteOperationSpec,
	opsTemplateRegistryRollbackOperationSpec,
} from "./ops-specs";
import {
	abTestListOperationSpec,
	abTestGetOperationSpec,
	abTestCreateOperationSpec,
	abTestAnalyzeOperationSpec,
	abTestLaunchOperationSpec,
	abTestStopOperationSpec,
	abTestDeleteOperationSpec,
	abTestRecommendSampleSizeOperationSpec,
	abTestDeployWinnerOperationSpec,
	abTestRunOperationSpec,
	abTestTickOperationSpec,
	abTestReconcileOperationSpec,
	abTestExportAssignmentOperationSpec,
} from "./abtest-specs";

export const standaloneOperationSpecs = [
	templatesReconcileOperationSpec,
	templatesCreateOperationSpec,
	templatesUpdateOperationSpec,
	templatesDeleteOperationSpec,
	templatesSetDefaultOperationSpec,
	templatesPreviewOperationSpec,
	listsCreateOperationSpec,
	listsUpdateOperationSpec,
	listsDeleteOperationSpec,
	subscribersCreateOperationSpec,
	subscribersUpdateOperationSpec,
	subscribersDeleteOperationSpec,
	subscribersAddToListsOperationSpec,
	subscribersRemoveFromListsOperationSpec,
	subscribersUnblocklistOperationSpec,
	subscribersImportStartOperationSpec,
	subscribersImportStatusOperationSpec,
	subscribersImportStopOperationSpec,
	subscribersImportLogsOperationSpec,
	subscribersExportOperationSpec,
	campaignsCreateOperationSpec,
	campaignsUpdateOperationSpec,
	campaignsDeleteOperationSpec,
	campaignsPauseOperationSpec,
	campaignsCloneOperationSpec,
	campaignsPreviewOperationSpec,
	campaignsTestOperationSpec,
	campaignsAnalyticsOperationSpec,
	dashboardCountsOperationSpec,
	dashboardChartsOperationSpec,
	mediaDeleteOperationSpec,
	mediaUploadOperationSpec,
	opsSegmentDriftOperationSpec,
	opsDailyDigestOperationSpec,
	opsDeliverabilityGuardOperationSpec,
	opsSubscriberHygieneOperationSpec,
	opsTemplateRegistrySyncOperationSpec,
	opsTemplateRegistryHistoryOperationSpec,
	opsTemplateRegistryPromoteOperationSpec,
	opsTemplateRegistryRollbackOperationSpec,
	abTestListOperationSpec,
	abTestGetOperationSpec,
	abTestCreateOperationSpec,
	abTestAnalyzeOperationSpec,
	abTestLaunchOperationSpec,
	abTestStopOperationSpec,
	abTestDeleteOperationSpec,
	abTestRecommendSampleSizeOperationSpec,
	abTestDeployWinnerOperationSpec,
	abTestRunOperationSpec,
	abTestTickOperationSpec,
	abTestReconcileOperationSpec,
	abTestExportAssignmentOperationSpec,
	bouncesListOperationSpec,
	bouncesGetOperationSpec,
	bouncesDeleteOperationSpec,
	bouncesPruneOperationSpec,
	systemAboutOperationSpec,
	systemLogsOperationSpec,
] as const;

/** @deprecated Use `standaloneOperationSpecs`. */
export const experimentalStandaloneOperationSpecs = standaloneOperationSpecs;
