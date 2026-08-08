export * from "./list-specs";
export * from "./subscriber-specs";
export * from "./campaign-specs";
export * from "./template-specs";
export * from "./media-specs";
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
} from "./subscriber-specs";
import {
	campaignsCreateOperationSpec,
	campaignsUpdateOperationSpec,
	campaignsDeleteOperationSpec,
	campaignsPauseOperationSpec,
	campaignsCloneOperationSpec,
} from "./campaign-specs";
import {
	templatesCreateOperationSpec,
	templatesUpdateOperationSpec,
	templatesDeleteOperationSpec,
	templatesSetDefaultOperationSpec,
	templatesReconcileOperationSpec,
} from "./template-specs";
import {
	mediaDeleteOperationSpec,
	mediaUploadOperationSpec,
} from "./media-specs";
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
	listsCreateOperationSpec,
	listsUpdateOperationSpec,
	listsDeleteOperationSpec,
	subscribersCreateOperationSpec,
	subscribersUpdateOperationSpec,
	subscribersDeleteOperationSpec,
	subscribersAddToListsOperationSpec,
	subscribersRemoveFromListsOperationSpec,
	subscribersUnblocklistOperationSpec,
	campaignsCreateOperationSpec,
	campaignsUpdateOperationSpec,
	campaignsDeleteOperationSpec,
	campaignsPauseOperationSpec,
	campaignsCloneOperationSpec,
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
] as const;

/** @deprecated Use `standaloneOperationSpecs`. */
export const experimentalStandaloneOperationSpecs = standaloneOperationSpecs;
