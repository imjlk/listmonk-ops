import generatedContractSchemas from "./generated/contract-schemas.json" with {
	type: "json",
};
import type { NormalizedContractSchema } from "./json";

const contracts = generatedContractSchemas as unknown as Readonly<{
	campaignGetInputContract: NormalizedContractSchema;
	campaignGetOutputContract: NormalizedContractSchema;
	campaignLifecycleInputContract: NormalizedContractSchema;
	campaignLifecycleOutputContract: NormalizedContractSchema;
	campaignPreflightInputContract: NormalizedContractSchema;
	campaignPreflightOutputContract: NormalizedContractSchema;
	campaignScheduleInputContract: NormalizedContractSchema;
	campaignScheduleOutputContract: NormalizedContractSchema;
	subscriberBlocklistInputContract: NormalizedContractSchema;
	subscriberBulkOutputContract: NormalizedContractSchema;
	transactionalSendInputContract: NormalizedContractSchema;
	transactionalSendOutputContract: NormalizedContractSchema;
}>;

export const campaignGetInputContract = contracts.campaignGetInputContract;
export const campaignGetOutputContract = contracts.campaignGetOutputContract;
export const campaignLifecycleInputContract =
	contracts.campaignLifecycleInputContract;
export const campaignLifecycleOutputContract =
	contracts.campaignLifecycleOutputContract;
export const campaignPreflightInputContract =
	contracts.campaignPreflightInputContract;
export const campaignPreflightOutputContract =
	contracts.campaignPreflightOutputContract;
export const campaignScheduleInputContract =
	contracts.campaignScheduleInputContract;
export const campaignScheduleOutputContract =
	contracts.campaignScheduleOutputContract;
export const subscriberBlocklistInputContract =
	contracts.subscriberBlocklistInputContract;
export const subscriberBulkOutputContract =
	contracts.subscriberBulkOutputContract;
export const transactionalSendInputContract =
	contracts.transactionalSendInputContract;
export const transactionalSendOutputContract =
	contracts.transactionalSendOutputContract;
