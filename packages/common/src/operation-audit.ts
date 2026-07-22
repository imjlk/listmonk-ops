import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	commitJsonFileStoreUpdate,
	readJsonFileStore,
	type JsonFileStore,
	updateJsonFileStore,
} from "./json-file-store";

export const OPERATION_AUDIT_STORE_VERSION = 1;
export const DEFAULT_OPERATION_AUDIT_LIMIT = 500;

const auditSurfaces = new Set(["cli", "mcp"]);
const auditEvents = new Set(["started", "blocked", "succeeded", "failed"]);

export type OperationAuditSurface = "cli" | "mcp";
export type OperationAuditEvent =
	| "started"
	| "blocked"
	| "succeeded"
	| "failed";

/**
 * Deliberately contains execution metadata only. Inputs, outputs, credentials,
 * and remote error text are excluded so the audit store does not become a
 * second copy of sensitive operational data.
 */
export type OperationAuditEntry = Readonly<{
	executionId: string;
	at: string;
	surface: OperationAuditSurface;
	operationId: string;
	event: OperationAuditEvent;
	confirmationRequired: boolean;
	confirmed: boolean;
	dryRun: boolean;
}>;

export type OperationAuditStore = Readonly<{
	version: typeof OPERATION_AUDIT_STORE_VERSION;
	entries: readonly OperationAuditEntry[];
}>;

export type RecordOperationAuditInput = Readonly<{
	executionId?: string;
	at?: string;
	surface: OperationAuditSurface;
	operationId: string;
	event: OperationAuditEvent;
	confirmationRequired: boolean;
	confirmed: boolean;
	dryRun: boolean;
}>;

export type OperationAuditStoreOptions = Readonly<{
	path?: string;
	limit?: number;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseNonBlankString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Invalid operation audit entry ${label}`);
	}
	return value;
}

function parseBoolean(value: unknown, label: string): boolean {
	if (typeof value !== "boolean") {
		throw new Error(`Invalid operation audit entry ${label}`);
	}
	return value;
}

function parseAuditEntry(value: unknown): OperationAuditEntry {
	if (!isRecord(value)) {
		throw new Error("Invalid operation audit entry");
	}

	const executionId = parseNonBlankString(value.executionId, "executionId");
	const at = parseNonBlankString(value.at, "at");
	if (Number.isNaN(Date.parse(at))) {
		throw new Error("Invalid operation audit entry at");
	}
	const surface = parseNonBlankString(value.surface, "surface");
	if (!auditSurfaces.has(surface)) {
		throw new Error("Invalid operation audit entry surface");
	}
	const operationId = parseNonBlankString(value.operationId, "operationId");
	const event = parseNonBlankString(value.event, "event");
	if (!auditEvents.has(event)) {
		throw new Error("Invalid operation audit entry event");
	}

	return {
		executionId,
		at,
		surface: surface as OperationAuditSurface,
		operationId,
		event: event as OperationAuditEvent,
		confirmationRequired: parseBoolean(
			value.confirmationRequired,
			"confirmationRequired",
		),
		confirmed: parseBoolean(value.confirmed, "confirmed"),
		dryRun: parseBoolean(value.dryRun, "dryRun"),
	};
}

function parseOperationAuditStore(value: unknown): OperationAuditStore {
	if (
		!isRecord(value) ||
		value.version !== OPERATION_AUDIT_STORE_VERSION ||
		!Array.isArray(value.entries)
	) {
		throw new Error("Invalid operation audit store");
	}

	return {
		version: OPERATION_AUDIT_STORE_VERSION,
		entries: value.entries.map(parseAuditEntry),
	};
}

function resolveAuditLimit(limit: number | undefined): number {
	const resolvedLimit = limit ?? DEFAULT_OPERATION_AUDIT_LIMIT;
	if (!Number.isInteger(resolvedLimit) || resolvedLimit <= 0) {
		throw new RangeError("Operation audit limit must be a positive integer");
	}
	return resolvedLimit;
}

export function getOperationAuditStorePath(): string {
	return (
		process.env.LISTMONK_OPS_AUDIT_STORE?.trim() ||
		join(homedir(), ".listmonk-ops", "operation-audit.json")
	);
}

export function createOperationAuditExecutionId(): string {
	return randomUUID();
}

export function createOperationAuditStore(
	path = getOperationAuditStorePath(),
): JsonFileStore<OperationAuditStore> {
	return {
		path,
		createDefault: () => ({
			version: OPERATION_AUDIT_STORE_VERSION,
			entries: [],
		}),
		parse: parseOperationAuditStore,
		lock: { timeoutMs: 5_000 },
	};
}

export async function listOperationAuditEntries(
	options: OperationAuditStoreOptions = {},
): Promise<readonly OperationAuditEntry[]> {
	const store = createOperationAuditStore(options.path);
	return (await readJsonFileStore(store)).entries;
}

export async function recordOperationAudit(
	input: RecordOperationAuditInput,
	options: OperationAuditStoreOptions = {},
): Promise<OperationAuditEntry> {
	const entry: OperationAuditEntry = {
		executionId: input.executionId ?? createOperationAuditExecutionId(),
		at: input.at ?? new Date().toISOString(),
		surface: input.surface,
		operationId: input.operationId,
		event: input.event,
		confirmationRequired: input.confirmationRequired,
		confirmed: input.confirmed,
		dryRun: input.dryRun,
	};
	const limit = resolveAuditLimit(options.limit);
	const store = createOperationAuditStore(options.path);

	return updateJsonFileStore(store, (current) =>
		commitJsonFileStoreUpdate(
			{
				version: OPERATION_AUDIT_STORE_VERSION,
				entries: [...current.entries, entry].slice(-limit),
			},
			entry,
		),
	);
}
