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
	listOperationCatalogFamilies,
	listOperationCatalogSummaries,
	mediaOperationCatalog,
	resolveOperationCatalogFamily,
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
	return listOperationCatalogSummaries(
		mcpOperationCatalog,
		resolveOperationCatalogFamily(mcpOperationCatalog, family),
	);
}

/** Families accepted by the `listmonk_list_operations` discovery tool. */
export function listMcpOperationCatalogFamilies(): readonly string[] {
	return listOperationCatalogFamilies(mcpOperationCatalog);
}
