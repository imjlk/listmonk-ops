import {
	createFileOutboundWebhookRepository,
	getOutboundWebhookStorePath,
	type OutboundWebhookRepository,
	type OutboundWebhookStoreOptions,
} from "./outbound-webhooks";
import {
	createPostgresOutboundWebhookRepository,
	type PostgresOutboundWebhookRepositoryOptions,
} from "./outbound-webhook-postgres";

export const OUTBOUND_WEBHOOK_DATABASE_URL_ENV =
	"LISTMONK_OPS_WEBHOOK_DATABASE_URL";

const repositoryCache = new Map<string, OutboundWebhookRepository>();

export interface OutboundWebhookRuntimeOptions {
	path?: string;
	databaseUrl?: string;
	postgres?: Omit<
		PostgresOutboundWebhookRepositoryOptions,
		"connectionString"
	>;
}

/**
 * Resolve exactly one persistence target. Refusing simultaneous file and
 * database configuration prevents CLI and MCP processes from silently writing
 * different outboxes.
 */
export function getOutboundWebhookStoreOptionsFromEnvironment(
	options: OutboundWebhookRuntimeOptions = {},
): OutboundWebhookStoreOptions {
	const path =
		options.path ??
		(process.env.LISTMONK_OPS_WEBHOOK_STORE?.trim() || undefined);
	const databaseUrl =
		options.databaseUrl ??
		(process.env[OUTBOUND_WEBHOOK_DATABASE_URL_ENV]?.trim() || undefined);
	if (path && databaseUrl) {
		throw new TypeError(
			`Configure only one of LISTMONK_OPS_WEBHOOK_STORE or ${OUTBOUND_WEBHOOK_DATABASE_URL_ENV}`,
		);
	}
	if (!databaseUrl) {
		return {
			repository: createFileOutboundWebhookRepository({
				path: path ?? getOutboundWebhookStorePath(),
			}),
		};
	}

	let repository = repositoryCache.get(databaseUrl);
	if (!repository) {
		repository = createPostgresOutboundWebhookRepository({
			connectionString: databaseUrl,
			...options.postgres,
		});
		repositoryCache.set(databaseUrl, repository);
	}
	return { repository };
}

export async function closeOutboundWebhookRuntimeRepositories(): Promise<void> {
	const repositories = [...repositoryCache.values()];
	repositoryCache.clear();
	await Promise.all(repositories.map((repository) => repository.close?.()));
}
