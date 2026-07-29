import {
	createFileSequenceRepository,
	getSequenceStorePath,
	type SequenceRepository,
} from "./sequences";
import {
	createPostgresSequenceRepository,
	type PostgresSequenceRepositoryOptions,
} from "./sequence-postgres";

export const SEQUENCE_DATABASE_URL_ENV =
	"LISTMONK_OPS_SEQUENCE_DATABASE_URL";
export const SEQUENCE_STORE_PATH_ENV = "LISTMONK_OPS_SEQUENCE_STORE";

const repositoryCache = new Map<string, SequenceRepository>();

export interface SequenceRuntimeOptions {
	path?: string;
	databaseUrl?: string;
	postgres?: Omit<PostgresSequenceRepositoryOptions, "connectionString">;
}

function cacheKey(
	databaseUrl: string,
	options: SequenceRuntimeOptions["postgres"],
): string {
	return JSON.stringify({
		databaseUrl,
		maxConnections: options?.maxConnections,
		idleTimeoutSeconds: options?.idleTimeoutSeconds,
		connectTimeoutSeconds: options?.connectTimeoutSeconds,
	});
}

export function getSequenceRepositoryFromEnvironment(
	options: SequenceRuntimeOptions = {},
): SequenceRepository {
	const path =
		options.path ??
		(process.env[SEQUENCE_STORE_PATH_ENV]?.trim() || undefined);
	const databaseUrl =
		options.databaseUrl ??
		(process.env[SEQUENCE_DATABASE_URL_ENV]?.trim() || undefined);
	if (path && databaseUrl) {
		throw new TypeError(
			`Configure only one of ${SEQUENCE_STORE_PATH_ENV} or ${SEQUENCE_DATABASE_URL_ENV}`,
		);
	}
	if (!databaseUrl) {
		return createFileSequenceRepository(path ?? getSequenceStorePath());
	}
	const key = cacheKey(databaseUrl, options.postgres);
	let repository = repositoryCache.get(key);
	if (!repository) {
		repository = createPostgresSequenceRepository({
			connectionString: databaseUrl,
			...options.postgres,
		});
		repositoryCache.set(key, repository);
	}
	return repository;
}

export async function closeSequenceRuntimeRepositories(): Promise<void> {
	const repositories = [...repositoryCache.values()];
	const results = await Promise.allSettled(
		repositories.map((repository) => repository.close?.()),
	);
	repositoryCache.clear();
	const failures = results
		.filter(
			(result): result is PromiseRejectedResult =>
				result.status === "rejected",
		)
		.map((result) => result.reason);
	if (failures.length > 0) {
		throw new AggregateError(
			failures,
			"Failed to close one or more sequence repositories",
		);
	}
}
