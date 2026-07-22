import {
	campaignOperationCatalog,
	composeOperationCatalogs,
	listOperationCatalog,
	listOperationCatalogSummaries,
	subscriberOperationCatalog,
	templateOperationCatalog,
	transactionalOperationCatalog,
} from "@listmonk-ops/operations";
import { abTestOperationCatalog } from "@listmonk-ops/abtest";
import { opsOperationCatalog } from "@listmonk-ops/automation";

export const cliOperationCatalog = composeOperationCatalogs([
	listOperationCatalog,
	subscriberOperationCatalog,
	campaignOperationCatalog,
	templateOperationCatalog,
	transactionalOperationCatalog,
	opsOperationCatalog,
	abTestOperationCatalog,
]);

export function listCliOperationCatalogSummaries(
	family?: string,
): ReturnType<typeof listOperationCatalogSummaries> {
	return listOperationCatalogSummaries(cliOperationCatalog, family);
}
