import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	commitJsonFileStoreUpdate,
	readJsonFileStore,
	type JsonFileStore,
	updateJsonFileStore,
} from "./json-file-store";

/**
 * A durable mapping from a caller-scoped create key to the resource that
 * was created, so an ambiguous create retry replays the original instead
 * of provisioning a duplicate. Schema-versioned and written atomically.
 */
export interface StoredResourceCreateRecord {
	key: string;
	payloadHash: string;
	targetHash: string;
	resourceKind: string;
	resourceId: string;
	createdAt: string;
}

export interface ResourceCreateStoreDocument {
	version: 1;
	records: Record<string, StoredResourceCreateRecord>;
}

export interface ResourceCreateIdempotencyStore {
	lookup(options: {
		key: string;
		targetHash: string;
	}): Promise<StoredResourceCreateRecord | undefined>;
	save(options: {
		key: string;
		payloadHash: string;
		targetHash: string;
		resourceKind: string;
		resourceId: string;
	}): Promise<void>;
}

/** Soft cap mirroring the transactional store bound. */
export const RESOURCE_CREATE_STORE_MAX_RECORDS = 10_000;

export function getResourceCreateStorePath(): string {
	return (
		process.env.LISTMONK_OPS_RESOURCE_CREATE_STORE?.trim() ||
		join(homedir(), ".listmonk-ops", "ops", "resource-creates.json")
	);
}

function parseResourceCreateStore(value: unknown): ResourceCreateStoreDocument {
	if (!isStoreRecord(value) || value.version !== 1) {
		throw new Error("Invalid resource create store: expected schema version 1");
	}
	if (typeof value.records !== "object" || value.records === null) {
		throw new Error("Invalid resource create store: records must be an object");
	}
	for (const [key, record] of Object.entries(value.records)) {
		if (
			!isStoreRecord(record) ||
			typeof record.key !== "string" ||
			typeof record.payloadHash !== "string" ||
			typeof record.targetHash !== "string" ||
			typeof record.resourceKind !== "string" ||
			typeof record.resourceId !== "string" ||
			typeof record.createdAt !== "string" ||
			record.key !== key
		) {
			throw new Error(
				`Invalid resource create store: record ${key} failed schema validation`,
			);
		}
	}
	return value as unknown as ResourceCreateStoreDocument;
}

function isStoreRecord(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === "object" && value !== null && !Array.isArray(value)
	);
}

function createResourceCreateStore(
	storePath: string,
): JsonFileStore<ResourceCreateStoreDocument> {
	return {
		path: storePath,
		createDefault: () => ({ version: 1, records: {} }),
		parse: parseResourceCreateStore,
	};
}

export function createFileBackedResourceCreateIdempotencyStore(
	options: { storePath?: string } = {},
): ResourceCreateIdempotencyStore {
	const storePath = options.storePath ?? getResourceCreateStorePath();
	const store = createResourceCreateStore(storePath);
	return {
		lookup: async ({ key, targetHash }) => {
			const document = await readJsonFileStore(store);
			const record = Object.hasOwn(document.records, key)
				? document.records[key]
				: undefined;
			if (record === undefined) {
				return undefined;
			}
			if (record.targetHash !== targetHash) {
				throw new Error(
					`Idempotency key already used against a different Listmonk target: ${key}`,
				);
			}
			return record;
		},
		save: async ({ key, payloadHash, targetHash, resourceKind, resourceId }) => {
			await updateJsonFileStore(store, (current) => {
				if (
					Object.hasOwn(current.records, key) &&
					current.records[key]?.resourceId !== resourceId
				) {
					throw new Error(
						`Idempotency key already bound to resource ${String(current.records[key]?.resourceId)}: ${key}`,
					);
				}
				const record: StoredResourceCreateRecord = {
					key,
					payloadHash,
					targetHash,
					resourceKind,
					resourceId,
					createdAt: new Date().toISOString(),
				};
				const keys = Object.keys(current.records);
				if (
					!Object.hasOwn(current.records, key) &&
					keys.length >= RESOURCE_CREATE_STORE_MAX_RECORDS
				) {
					throw new Error(
						"Resource create idempotency store is full; expire old records before claiming new ones",
					);
				}
				return commitJsonFileStoreUpdate(
					{ version: 1, records: { ...current.records, [key]: record } },
					undefined,
				);
			});
		},
	};
}

/** Deterministic record identity for tests and diagnostics. */
export function resourceCreateTestKey(kind: string): string {
	return `${kind}:${randomUUID()}`;
}
