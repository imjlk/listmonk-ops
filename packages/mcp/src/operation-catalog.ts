import { abTestOperationCatalog } from "@listmonk-ops/abtest";
import {
	opsOperationCatalog,
	providerOperationCatalog,
	sequenceOperationCatalog,
	webhookOperationCatalog,
} from "@listmonk-ops/automation";
import {
	campaignOperationCatalog,
	composeOperationCatalogs,
	discoveryOperationCatalog,
	listOperationCatalog,
	listOperationCatalogSummaries,
	mediaOperationCatalog,
	subscriberOperationCatalog,
	templateOperationCatalog,
	transactionalOperationCatalog,
} from "@listmonk-ops/operations";

export const mcpOperationCatalog = composeOperationCatalogs([
	listOperationCatalog,
	subscriberOperationCatalog,
	campaignOperationCatalog,
	templateOperationCatalog,
	mediaOperationCatalog,
	transactionalOperationCatalog,
	opsOperationCatalog,
	abTestOperationCatalog,
	discoveryOperationCatalog,
	webhookOperationCatalog,
	sequenceOperationCatalog,
	providerOperationCatalog,
]);

export function listMcpOperationCatalogSummaries(
	family?: string,
): ReturnType<typeof listOperationCatalogSummaries> {
	return listOperationCatalogSummaries(mcpOperationCatalog, family);
}
