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
	specSearchInputContract: NormalizedContractSchema;
	specSearchOutputContract: NormalizedContractSchema;
	specDescribeInputContract: NormalizedContractSchema;
	specDescribeOutputContract: NormalizedContractSchema;
	emptyInputContract: NormalizedContractSchema;
	playbookListOutputContract: NormalizedContractSchema;
	playbookGetInputContract: NormalizedContractSchema;
	playbookGetOutputContract: NormalizedContractSchema;
	controlCapabilitiesOutputContract: NormalizedContractSchema;
	controlPrimeInputContract: NormalizedContractSchema;
	controlPrimeOutputContract: NormalizedContractSchema;
	controlStatusInputContract: NormalizedContractSchema;
	controlStatusOutputContract: NormalizedContractSchema;
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
export const specSearchInputContract = contracts.specSearchInputContract;
export const specSearchOutputContract = contracts.specSearchOutputContract;
export const specDescribeInputContract = contracts.specDescribeInputContract;
export const specDescribeOutputContract = contracts.specDescribeOutputContract;
export const emptyInputContract = contracts.emptyInputContract;
export const playbookListOutputContract =
	contracts.playbookListOutputContract;
export const playbookGetInputContract = contracts.playbookGetInputContract;
export const playbookGetOutputContract = contracts.playbookGetOutputContract;
export const controlCapabilitiesOutputContract =
	contracts.controlCapabilitiesOutputContract;
export const controlPrimeInputContract = contracts.controlPrimeInputContract;
export const controlPrimeOutputContract = contracts.controlPrimeOutputContract;
export const controlStatusInputContract = contracts.controlStatusInputContract;
export const controlStatusOutputContract =
	contracts.controlStatusOutputContract;
