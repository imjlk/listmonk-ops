import { abTestOperationCatalog } from "../packages/abtest/src/operations";
import { opsOperationCatalog } from "../packages/automation/src/ops-operations";
import { providerOperationCatalog } from "../packages/automation/src/provider-operations";
import { sequenceOperationCatalog } from "../packages/automation/src/sequence-operations";
import { webhookOperationCatalog } from "../packages/automation/src/webhook-operations";
import {
	campaignOperationCatalog,
	discoveryOperationCatalog,
	listOperationCatalog,
	mediaOperationCatalog,
	type OperationCatalog,
	subscriberOperationCatalog,
	templateOperationCatalog,
	transactionalOperationCatalog,
} from "../packages/operations/src";

/**
 * Raw family catalogs shared by repository checks and contract generation.
 * Runtime contract validation is deliberately deferred until these catalogs
 * are composed, allowing the generator to observe a changed normalized
 * boundary and update its committed bridge snapshot without a global bypass.
 */
export const sharedOperationCatalogs: readonly OperationCatalog[] = [
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
];
