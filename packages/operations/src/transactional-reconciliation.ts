import { z } from "zod";
import {
	defineOperation,
	normalizeOperationExecutionError,
	OperationInputError,
	parseOperationInput,
	parseOperationOutput,
} from "./operation";
import {
	computeTransactionalTargetHash,
	type TransactionalIdempotencyStore,
	type TransactionalSendRecord,
} from "./transactional-idempotency";
import {
	bindTransactionalRecordsOperationSpec,
	bindTransactionalReconcileOperationSpec,
} from "./specs";

const keySchema = z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9._:-]+$/);
const recordStatusSchema = z.enum(["pending", "accepted", "failed", "unknown"]);
const recordViewSchema = z.object({
	key: keySchema,
	status: recordStatusSchema,
	payload_hash: z.string(),
	revision: z.string(),
	created_at: z.iso.datetime({ offset: true }),
	updated_at: z.iso.datetime({ offset: true }),
	expires_at: z.iso.datetime({ offset: true }),
	sent: z.boolean().optional(),
	error_present: z.boolean(),
});
const recordsInputSchema = z.object({
	key: keySchema.optional(),
	status: recordStatusSchema.optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50),
	cursor: z.string().max(320).optional(),
});
const recordsOutputSchema = z.object({
	records: z.array(recordViewSchema),
	total: z.number().int().nonnegative(),
	next_cursor: z.string().optional(),
});
const reconcileInputSchema = z.object({
	key: keySchema,
	expected_revision: z.string().min(1),
	decision: z.enum(["accepted", "retry"]),
	reason: z.string().trim().min(10).max(500).regex(
		/^[^\u0000-\u001f\u007f]+$/u,
		"reason must contain printable characters only",
	),
	quiesced: z.boolean().optional(),
});
const reconcileOutputSchema = z.object({
	key: keySchema,
	decision: z.enum(["accepted", "retry"]),
	reconciled_at: z.iso.datetime(),
	revision: z.string().optional(),
});

export interface TransactionalReconciliationContext {
	idempotencyStore?: TransactionalIdempotencyStore;
	target?: { baseUrl?: string; username?: string };
}

function requireStore(context: TransactionalReconciliationContext): TransactionalIdempotencyStore {
	if (!context.idempotencyStore) throw new OperationInputError("This surface does not provide a transactional idempotency store");
	return context.idempotencyStore;
}

function currentTargetHash(context: TransactionalReconciliationContext): string {
	if (!context.target?.baseUrl || !context.target.username) throw new OperationInputError("Resolved Listmonk target is required to inspect or reconcile transactional records");
	return computeTransactionalTargetHash(context.target);
}

function recordView(record: TransactionalSendRecord) {
	return {
		key: record.key,
		status: record.status,
		payload_hash: record.payloadHash,
		revision: record.claimToken,
		created_at: record.createdAt,
		updated_at: record.updatedAt,
		expires_at: record.expiresAt,
		...(record.sent === undefined ? {} : { sent: record.sent }),
		error_present: Boolean(record.errorMessage),
	};
}

function decodeRecordCursor(cursor: string): { updatedMs: number; key: string } {
	const separator = cursor.indexOf("|");
	const timestamp = cursor.slice(0, separator);
	const key = cursor.slice(separator + 1);
	const updatedMs = Date.parse(timestamp);
	if (separator < 0 || !Number.isFinite(updatedMs) || new Date(updatedMs).toISOString() !== timestamp || !keySchema.safeParse(key).success) {
		throw new OperationInputError("Invalid transactional record cursor");
	}
	return { updatedMs, key };
}

function compareRecordKeys(a: string, b: string): number {
	if (a < b) return -1;
	if (a > b) return 1;
	return 0;
}

/** Inspect only metadata for the current Listmonk target; never return message contents or raw errors. */
export async function listTransactionalRecords(context: TransactionalReconciliationContext, input: z.output<typeof recordsInputSchema>) {
	const targetHash = currentTargetHash(context);
	const document = await requireStore(context).load();
	const matching = Object.values(document.records)
		.filter((record) => record.targetHash === targetHash && (input.key === undefined || record.key === input.key) && (input.status === undefined || record.status === input.status))
		.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || compareRecordKeys(a.key, b.key));
	const cursor = input.cursor === undefined
		? undefined
		: decodeRecordCursor(input.cursor);
	const following = cursor === undefined ? matching : matching.filter((record) => {
		const updatedMs = Date.parse(record.updatedAt);
		return updatedMs < cursor.updatedMs || (updatedMs === cursor.updatedMs && record.key > cursor.key);
	});
	const page = following.slice(0, input.limit);
	const last = page.at(-1);
	return {
		records: page.map(recordView),
		total: matching.length,
		...(following.length > page.length && last ? { next_cursor: `${new Date(last.updatedAt).toISOString()}|${last.key}` } : {}),
	};
}

/** Apply an explicit operator conclusion; this operation never sends a message. */
export async function reconcileTransactionalRecord(context: TransactionalReconciliationContext, input: z.output<typeof reconcileInputSchema>) {
	const store = requireStore(context);
	if (!store.reconcile) throw new OperationInputError("This surface does not support transactional reconciliation");
	const result = await store.reconcile({
		key: input.key,
		targetHash: currentTargetHash(context),
		expectedRevision: input.expected_revision,
		decision: input.decision,
		reason: input.reason,
		quiesced: input.quiesced,
	});
	return {
		key: result.key,
		decision: result.decision,
		reconciled_at: result.reconciledAt,
		...(result.revision ? { revision: result.revision } : {}),
	};
}

export const transactionalRecordsOperation = defineOperation({
	id: "transactional.list",
	title: "Inspect transactional send records",
	description: "Inspect redacted idempotency records for the selected Listmonk target; may initialize or migrate the claim store.",
	inputSchema: recordsInputSchema,
	outputSchema: recordsOutputSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_transactional_records" },
	spec: bindTransactionalRecordsOperationSpec(),
	execute: listTransactionalRecords,
});

export const transactionalReconcileOperation = defineOperation({
	id: "transactional.reconcile",
	title: "Reconcile transactional send record",
	description: "Record an explicit operator delivery decision or permit a later retry without sending mail.",
	inputSchema: reconcileInputSchema,
	outputSchema: reconcileOutputSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: false,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_reconcile_transactional" },
	spec: bindTransactionalReconcileOperationSpec(),
	execute: reconcileTransactionalRecord,
});

export async function invokeTransactionalRecordsOperation(context: TransactionalReconciliationContext, input: unknown) {
	const parsed = parseOperationInput(
		transactionalRecordsOperation.inputSchema,
		input,
	);
	try {
		return parseOperationOutput(
			transactionalRecordsOperation.id,
			transactionalRecordsOperation.outputSchema,
			await listTransactionalRecords(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(
			transactionalRecordsOperation.id,
			error,
		);
	}
}

export async function invokeTransactionalReconcileOperation(context: TransactionalReconciliationContext, input: unknown) {
	const parsed = parseOperationInput(
		transactionalReconcileOperation.inputSchema,
		input,
	);
	try {
		return parseOperationOutput(
			transactionalReconcileOperation.id,
			transactionalReconcileOperation.outputSchema,
			await reconcileTransactionalRecord(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(
			transactionalReconcileOperation.id,
			error,
		);
	}
}
