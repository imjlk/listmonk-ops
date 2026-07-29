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
export const OUTBOUND_WEBHOOK_STORE_PATH_ENV = "LISTMONK_OPS_WEBHOOK_STORE";

const repositoryCache = new Map<string, OutboundWebhookRepository>();

export interface OutboundWebhookRuntimeOptions {
	path?: string;
	databaseUrl?: string;
	postgres?: Omit<
		PostgresOutboundWebhookRepositoryOptions,
		"connectionString"
	>;
}

function postgresRepositoryCacheKey(
	databaseUrl: string,
	options: OutboundWebhookRuntimeOptions["postgres"],
): string {
	return JSON.stringify({
		databaseUrl,
		maxConnections: options?.maxConnections,
		idleTimeoutSeconds: options?.idleTimeoutSeconds,
		connectTimeoutSeconds: options?.connectTimeoutSeconds,
	});
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
		(process.env[OUTBOUND_WEBHOOK_STORE_PATH_ENV]?.trim() || undefined);
	const databaseUrl =
		options.databaseUrl ??
		(process.env[OUTBOUND_WEBHOOK_DATABASE_URL_ENV]?.trim() || undefined);
	if (path && databaseUrl) {
		throw new TypeError(
			`Configure only one of ${OUTBOUND_WEBHOOK_STORE_PATH_ENV} or ${OUTBOUND_WEBHOOK_DATABASE_URL_ENV}`,
		);
	}
	if (!databaseUrl) {
		return {
			repository: createFileOutboundWebhookRepository({
				path: path ?? getOutboundWebhookStorePath(),
			}),
		};
	}

	const cacheKey = postgresRepositoryCacheKey(databaseUrl, options.postgres);
	let repository = repositoryCache.get(cacheKey);
	if (!repository) {
		repository = createPostgresOutboundWebhookRepository({
			connectionString: databaseUrl,
			...options.postgres,
		});
		repositoryCache.set(cacheKey, repository);
	}
	return { repository };
}

export async function closeOutboundWebhookRuntimeRepositories(): Promise<void> {
	const repositories = [...repositoryCache.values()];
	const results = await Promise.allSettled(
		repositories.map((repository) => repository.close?.()),
	);
	repositoryCache.clear();
	const failures = results
		.filter(
			(result): result is PromiseRejectedResult => result.status === "rejected",
		)
		.map((result) => result.reason);
	if (failures.length > 0) {
		throw new AggregateError(
			failures,
			"Failed to close one or more outbound webhook repositories",
		);
	}
}
