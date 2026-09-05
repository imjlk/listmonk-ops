import {
	bouncesOperationCatalog,
	campaignOperationCatalog,
	composeOperationCatalogs,
	dashboardOperationCatalog,
	discoveryOperationCatalog,
	listOperationCatalog,
	listOperationCatalogSummaries,
	mediaOperationCatalog,
	subscriberOperationCatalog,
	systemOperationCatalog,
	templateOperationCatalog,
	transactionalOperationCatalog,
	userRoleOperationCatalog,
} from "@listmonk-ops/operations";
import { abTestOperationCatalog } from "@listmonk-ops/abtest";
import {
	opsOperationCatalog,
	providerOperationCatalog,
	sequenceOperationCatalog,
	webhookOperationCatalog,
} from "@listmonk-ops/automation";

export const cliOperationCatalog = composeOperationCatalogs([
	listOperationCatalog,
	subscriberOperationCatalog,
	campaignOperationCatalog,
	templateOperationCatalog,
	mediaOperationCatalog,
	bouncesOperationCatalog,
	dashboardOperationCatalog,
	systemOperationCatalog,
	transactionalOperationCatalog,
	opsOperationCatalog,
	abTestOperationCatalog,
	discoveryOperationCatalog,
	webhookOperationCatalog,
	sequenceOperationCatalog,
	providerOperationCatalog,
	userRoleOperationCatalog,
]);

export function listCliOperationCatalogSummaries(
	family?: string,
): ReturnType<typeof listOperationCatalogSummaries> {
	return listOperationCatalogSummaries(cliOperationCatalog, family);
}
