import generatedContractSchemas from "./generated/contract-schemas.json" with {
	type: "json",
};
import type { ProductContractSchema } from "./json";

const contracts = generatedContractSchemas as unknown as Readonly<{
	campaignGetInputContract: ProductContractSchema;
	campaignGetOutputContract: ProductContractSchema;
	campaignScheduleInputContract: ProductContractSchema;
	campaignScheduleOutputContract: ProductContractSchema;
	subscriberBlocklistInputContract: ProductContractSchema;
	subscriberBulkOutputContract: ProductContractSchema;
}>;

export const campaignGetInputContract = contracts.campaignGetInputContract;
export const campaignGetOutputContract = contracts.campaignGetOutputContract;
export const campaignScheduleInputContract =
	contracts.campaignScheduleInputContract;
export const campaignScheduleOutputContract =
	contracts.campaignScheduleOutputContract;
export const subscriberBlocklistInputContract =
	contracts.subscriberBlocklistInputContract;
export const subscriberBulkOutputContract =
	contracts.subscriberBulkOutputContract;
