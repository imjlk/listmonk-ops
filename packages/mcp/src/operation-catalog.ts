import { abTestOperationCatalog } from "@listmonk-ops/abtest";
import {
	opsOperationCatalog,
	providerOperationCatalog,
	sequenceOperationCatalog,
	webhookOperationCatalog,
} from "@listmonk-ops/automation";
import {
	bouncesOperationCatalog,
	campaignOperationCatalog,
	dashboardOperationCatalog,
	composeOperationCatalogs,
	systemOperationCatalog,
	discoveryOperationCatalog,
	maintenanceOperationCatalog,
	listOperationCatalog,
	listOperationCatalogSummaries,
	mediaOperationCatalog,
	settingsOperationCatalog,
	subscriberOperationCatalog,
	templateOperationCatalog,
	transactionalOperationCatalog,
	userRoleOperationCatalog,
} from "@listmonk-ops/operations";

export const mcpOperationCatalog = composeOperationCatalogs([
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
	settingsOperationCatalog,
	maintenanceOperationCatalog,
]);

export function listMcpOperationCatalogSummaries(
	family?: string,
): ReturnType<typeof listOperationCatalogSummaries> {
	return listOperationCatalogSummaries(mcpOperationCatalog, family);
}
