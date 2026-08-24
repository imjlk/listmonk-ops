import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	commitJsonFileStoreUpdate,
	readJsonFileStore,
	type JsonFileStore,
	updateJsonFileStore,
} from "@listmonk-ops/common";
import {
	transactionalFromEmailSchema,
	transactionalMessengerSchema,
	transactionalSubjectSchema,
	type TransactionalIdempotencyStore,
} from "@listmonk-ops/operations";
import { z } from "zod";

export const SEQUENCE_STORE_VERSION = 1;
export const DEFAULT_SEQUENCE_LEASE_MS = 90_000;
export const DEFAULT_SEQUENCE_WORKER_STALE_MS = 90_000;
export const DEFAULT_SEQUENCE_WORKER_RETENTION_MS =
	30 * 24 * 60 * 60 * 1_000;

const isoDateTimeSchema = z.iso.datetime({ offset: true });
const sequenceIdSchema = z.uuid();
const stepIdSchema = z
	.string()
	.trim()
	.min(1)
	.max(80)
	.regex(/^[A-Za-z0-9._:-]+$/);
const jsonObjectSchema = z.record(z.string(), z.unknown());

export const SEQUENCE_STEP_TYPES = [
	"send",
	"wait",
	"wait_until",
	"condition",
	"stop",
] as const;

const sequenceSendStepSchema = z.object({
	id: stepIdSchema,
	type: z.literal(SEQUENCE_STEP_TYPES[0]),
	templateId: z.number().int().positive(),
	fromEmail: transactionalFromEmailSchema.optional(),
	data: jsonObjectSchema.optional(),
	contentType: z.enum(["html", "markdown", "plain"]).optional(),
	messenger: transactionalMessengerSchema.optional(),
	subject: transactionalSubjectSchema.optional(),
	altBody: z.string().min(1).optional(),
});

export const sequenceStepSchema = z.discriminatedUnion("type", [
	sequenceSendStepSchema,
	z.object({
		id: stepIdSchema,
		type: z.literal(SEQUENCE_STEP_TYPES[1]),
		durationSeconds: z.number().int().min(1).max(31_536_000),
	}),
	z.object({
		id: stepIdSchema,
		type: z.literal(SEQUENCE_STEP_TYPES[2]),
		at: isoDateTimeSchema,
	}),
	z.object({
		id: stepIdSchema,
		type: z.literal(SEQUENCE_STEP_TYPES[3]),
		path: z
			.string()
			.trim()
			.min(1)
			.max(200)
			.regex(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/),
		operator: z.enum(["equals", "not_equals", "exists"]),
		value: z.unknown().optional(),
		onTrue: stepIdSchema,
		onFalse: stepIdSchema,
	}),
	z.object({
		id: stepIdSchema,
		type: z.literal(SEQUENCE_STEP_TYPES[4]),
	}),
]);

// Version 1 stores predate the strict single-mailbox sender contract. Keep
// those definitions readable so one legacy step cannot make the complete
// repository unavailable; new definitions and revisions still parse through
// `sequenceStepSchema`, and the executor quarantines an invalid legacy sender
// before any Listmonk request.
const storedSequenceStepSchema = z.union([
	sequenceStepSchema,
	sequenceSendStepSchema.extend({
		fromEmail: z.string().trim().min(1).optional(),
	}),
]);

export type SequenceStep = z.output<typeof sequenceStepSchema>;
export type SequenceDefinitionStatus = "active" | "paused";
export type SequenceEnrollmentStatus =
	| "pending"
	| "running"
	| "waiting"
	| "paused"
	| "completed"
	| "failed"
	| "ambiguous"
	| "cancelled";
export type SequenceWorkerStatus = "running" | "stopped" | "failed";

export type SequenceRevision = Readonly<{
	revision: number;
	steps: readonly SequenceStep[];
	createdAt: string;
}>;

export type SequenceDefinition = Readonly<{
	id: string;
	name: string;
	description?: string | undefined;
	status: SequenceDefinitionStatus;
	currentRevision: number;
	revisions: readonly SequenceRevision[];
	createdAt: string;
	updatedAt: string;
}>;

export type SequenceUpdateResult = Readonly<{
	definition: SequenceDefinition;
	updated: boolean;
}>;

export type SequenceEnrollment = Readonly<{
	id: string;
	sequenceId: string;
	revision: number;
	subscriberId: number;
	context: Readonly<Record<string, unknown>>;
	status: SequenceEnrollmentStatus;
	retryCount: number;
	currentStepId: string;
	nextRunAt: string;
	leaseToken?: string | undefined;
	leaseExpiresAt?: string | undefined;
	lastError?: string | undefined;
	lastTransitionAt: string;
	createdAt: string;
	updatedAt: string;
}>;

export type SequenceWorker = Readonly<{
	id: string;
	status: SequenceWorkerStatus;
	startedAt: string;
	heartbeatAt: string;
	stoppedAt?: string | undefined;
	lastError?: string | undefined;
	lastTick?: SequenceTickSummary | undefined;
}>;

export type SequenceTickSummary = Readonly<{
	claimed: number;
	/** Echoed ids of the exact enrollments this tick claimed. */
	claimedIds: readonly string[];
	/** Echoed claim positions: enrollment id plus its originally claimed step. */
	claimedSteps: readonly Readonly<{ id: string; stepId: string }>[];
	advanced: number;
	waiting: number;
	completed: number;
	failed: number;
	ambiguous: number;
	cancelled: number;
	completedAt: string;
}>;

export type SequenceRuntimeHealth = Readonly<{
	store: "file" | "postgres";
	schemaVersion: number;
	healthy: boolean;
	checkedAt: string;
	definitions: Readonly<{
		total: number;
		active: number;
		paused: number;
	}>;
	enrollments: Readonly<
		Record<SequenceEnrollmentStatus, number> & {
			due: number;
			leased: number;
			oldestDueAt?: string | undefined;
		}
	>;
	workers: Readonly<{
		running: number;
		stale: number;
		stopped: number;
		failed: number;
		lastHeartbeatAt?: string | undefined;
	}>;
}>;

export type CreateSequenceDefinitionInput = Readonly<{
	id?: string;
	name: string;
	description?: string;
	steps: readonly SequenceStep[];
}>;

export type UpdateSequenceDefinitionInput = Readonly<{
	name?: string;
	description?: string;
	steps: readonly SequenceStep[];
}>;

export type CreateSequenceEnrollmentInput = Readonly<{
	id?: string;
	sequenceId: string;
	subscriberId: number;
	context?: Readonly<Record<string, unknown>>;
	startAt?: string;
}>;

export type SequenceEnrollmentListOptions = Readonly<{
	sequenceId?: string;
	status?: SequenceEnrollmentStatus;
	subscriberId?: number;
	limit?: number;
}>;

export type SequenceReconcileResult = Readonly<{
	/** Echoed ids of the enrollments the scan considered. */
	scannedIds: readonly string[];
	scanned: number;
	recovered: number;
	unchanged: number;
	dryRun: boolean;
}>;

export type ClaimedSequenceEnrollment = Readonly<{
	enrollment: SequenceEnrollment;
	definition: SequenceDefinition;
	revision: SequenceRevision;
}>;

export interface SequenceRepository {
	readonly kind: "file" | "postgres";
	/**
	 * Shared transactional idempotency store when the repository can provide
	 * one. Postgres repositories expose a database-backed implementation so
	 * every worker observes the same send claims.
	 */
	readonly idempotencyStore?: TransactionalIdempotencyStore;
	listDefinitions(): Promise<readonly SequenceDefinition[]>;
	getDefinition(id: string): Promise<SequenceDefinition>;
	createDefinition(
		definition: SequenceDefinition,
	): Promise<SequenceDefinition>;
	updateDefinition(
		id: string,
		input: UpdateSequenceDefinitionInput,
		now: Date,
	): Promise<SequenceUpdateResult>;
	deleteDefinition(id: string): Promise<SequenceDefinition>;
	setDefinitionStatus(
		id: string,
		status: SequenceDefinitionStatus,
		now: Date,
	): Promise<SequenceDefinition>;
	listEnrollments(
		options?: SequenceEnrollmentListOptions,
	): Promise<readonly SequenceEnrollment[]>;
	getEnrollment(id: string): Promise<SequenceEnrollment>;
	createEnrollment(
		enrollment: SequenceEnrollment,
	): Promise<SequenceEnrollment>;
	claimDue(options: Readonly<{
		limit: number;
		now: Date;
		leaseMs: number;
	}>): Promise<readonly ClaimedSequenceEnrollment[]>;
	/**
	 * Claim exactly the requested enrollment ids when they are still
	 * claimable (same eligibility rule as claimDue). Entries that exist but
	 * are not claimable — already advanced, completed, ambiguous, or leased
	 * by a live worker — are skipped so an echoed-set retry converges
	 * instead of doing new work; unknown ids are rejected.
	 */
	claimSpecific(options: Readonly<{
		claims: readonly Readonly<{ id: string; stepId: string }>[];
		now: Date;
		leaseMs: number;
	}>): Promise<readonly ClaimedSequenceEnrollment[]>;
	completeClaim(
		enrollment: SequenceEnrollment,
		next: Omit<SequenceEnrollment, "leaseToken" | "leaseExpiresAt">,
	): Promise<SequenceEnrollment>;
	resolveAmbiguous(
		enrollment: SequenceEnrollment,
		next: Omit<SequenceEnrollment, "leaseToken" | "leaseExpiresAt">,
	): Promise<SequenceEnrollment>;
	reconcile(options: Readonly<{
		now: Date;
		limit: number;
		dryRun: boolean;
		/** Recovery binding: restrict the expired-lease scan to exactly these enrollments. */
		enrollmentIds?: readonly string[];
	}>): Promise<SequenceReconcileResult>;
	getRuntimeHealth(options: Readonly<{
		now: Date;
		workerStaleMs: number;
	}>): Promise<SequenceRuntimeHealth>;
	upsertWorker(worker: SequenceWorker): Promise<void>;
	close?(): Promise<void>;
}

type SequenceStore = Readonly<{
	version: typeof SEQUENCE_STORE_VERSION;
	definitions: readonly SequenceDefinition[];
	enrollments: readonly SequenceEnrollment[];
	workers: readonly SequenceWorker[];
}>;

const revisionSchema = z.object({
	revision: z.number().int().positive(),
	steps: z.array(sequenceStepSchema).min(1),
	createdAt: isoDateTimeSchema,
});
const storedRevisionSchema = revisionSchema.extend({
	steps: z.array(storedSequenceStepSchema).min(1),
});
const definitionBaseSchema = z.object({
	id: sequenceIdSchema,
	name: z.string().trim().min(1).max(120),
	description: z.string().trim().max(500).optional(),
	status: z.enum(["active", "paused"]),
	currentRevision: z.number().int().positive(),
	createdAt: isoDateTimeSchema,
	updatedAt: isoDateTimeSchema,
});
const definitionSchema = definitionBaseSchema.extend({
	revisions: z.array(revisionSchema).min(1),
});
const storedDefinitionSchema = definitionBaseSchema.extend({
	revisions: z.array(storedRevisionSchema).min(1),
});
export const sequenceEnrollmentStatusSchema = z.enum([
	"pending",
	"running",
	"waiting",
	"paused",
	"completed",
	"failed",
	"ambiguous",
	"cancelled",
]);
const enrollmentSchema = z.object({
	id: sequenceIdSchema,
	sequenceId: sequenceIdSchema,
	revision: z.number().int().positive(),
	subscriberId: z.number().int().positive(),
	context: jsonObjectSchema,
	status: sequenceEnrollmentStatusSchema,
	retryCount: z.number().int().nonnegative().default(0),
	currentStepId: stepIdSchema,
	nextRunAt: isoDateTimeSchema,
	leaseToken: sequenceIdSchema.optional(),
	leaseExpiresAt: isoDateTimeSchema.optional(),
	lastError: z.string().max(1_000).optional(),
	lastTransitionAt: isoDateTimeSchema,
	createdAt: isoDateTimeSchema,
	updatedAt: isoDateTimeSchema,
});
const tickSummarySchema = z.object({
	claimed: z.number().int().nonnegative(),
	claimedIds: z.array(sequenceIdSchema).default([]),
	claimedSteps: z
		.array(
			z.object({ id: sequenceIdSchema, stepId: z.string().min(1) }),
		)
		.default([]),
	advanced: z.number().int().nonnegative(),
	waiting: z.number().int().nonnegative(),
	completed: z.number().int().nonnegative(),
	failed: z.number().int().nonnegative(),
	ambiguous: z.number().int().nonnegative(),
	cancelled: z.number().int().nonnegative(),
	completedAt: isoDateTimeSchema,
});
const workerSchema = z.object({
	id: sequenceIdSchema,
	status: z.enum(["running", "stopped", "failed"]),
	startedAt: isoDateTimeSchema,
	heartbeatAt: isoDateTimeSchema,
	stoppedAt: isoDateTimeSchema.optional(),
	lastError: z.string().max(1_000).optional(),
	lastTick: tickSummarySchema.optional(),
});
const storeSchema = z.object({
	version: z.literal(SEQUENCE_STORE_VERSION),
	definitions: z.array(storedDefinitionSchema),
	enrollments: z.array(enrollmentSchema),
	workers: z.array(workerSchema),
});

export class SequenceNotFoundError extends Error {
	public constructor(kind: "definition" | "enrollment", id: string) {
		super(`Sequence ${kind} not found: ${id}`);
		this.name = "SequenceNotFoundError";
	}
}

export class SequenceConflictError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = "SequenceConflictError";
	}
}

export function validateSequenceSteps(
	steps: readonly SequenceStep[],
): readonly SequenceStep[] {
	const parsed = z.array(sequenceStepSchema).min(1).parse(steps);
	return validateSequenceStepTopology(parsed);
}

function validateSequenceStepTopology(
	parsed: readonly SequenceStep[],
): readonly SequenceStep[] {
	const ids = new Set<string>();
	for (const step of parsed) {
		if (ids.has(step.id)) {
			throw new SequenceConflictError(
				`Sequence step ID must be unique: ${step.id}`,
			);
		}
		ids.add(step.id);
	}
	for (const step of parsed) {
		const stepIndex = parsed.findIndex((candidate) => candidate.id === step.id);
		if (
			(step.type === "wait" || step.type === "wait_until") &&
			stepIndex === parsed.length - 1
		) {
			throw new SequenceConflictError(
				`Sequence ${step.type} step ${step.id} must be followed by another step`,
			);
		}
		if (step.type !== "condition") {
			continue;
		}
		for (const target of [step.onTrue, step.onFalse]) {
			const targetIndex = parsed.findIndex(
				(candidate) => candidate.id === target,
			);
			if (targetIndex < 0) {
				throw new SequenceConflictError(
					`Condition step ${step.id} references missing step: ${target}`,
				);
			}
			if (targetIndex <= stepIndex) {
				throw new SequenceConflictError(
					`Condition step ${step.id} must branch to a later step: ${target}`,
				);
			}
		}
	}
	return parsed;
}

export function parseSequenceDefinition(value: unknown): SequenceDefinition {
	const parsed = definitionSchema.parse(value);
	return validateSequenceDefinitionHistory(parsed);
}

/** Parses storage created before strict sender validation without weakening new writes. */
export function parsePersistedSequenceDefinition(
	value: unknown,
): SequenceDefinition {
	const parsed = storedDefinitionSchema.parse(value);
	return validateSequenceDefinitionHistory(parsed);
}

function validateSequenceDefinitionHistory(
	parsed: SequenceDefinition,
): SequenceDefinition {
	const revisionNumbers = parsed.revisions.map((entry) => entry.revision);
	if (
		new Set(revisionNumbers).size !== revisionNumbers.length ||
		!revisionNumbers.includes(parsed.currentRevision)
	) {
		throw new SequenceConflictError(
			`Sequence ${parsed.id} has an invalid revision history`,
		);
	}
	for (const revision of parsed.revisions) {
		validateSequenceStepTopology(revision.steps);
	}
	return parsed;
}

export function parseSequenceEnrollment(value: unknown): SequenceEnrollment {
	return enrollmentSchema.parse(value);
}

function parseStore(value: unknown): SequenceStore {
	const parsed = storeSchema.parse(value);
	return {
		...parsed,
		definitions: parsed.definitions.map(parsePersistedSequenceDefinition),
	};
}

export function getSequenceStorePath(): string {
	return (
		process.env.LISTMONK_OPS_SEQUENCE_STORE?.trim() ||
		join(homedir(), ".listmonk-ops", "sequences.json")
	);
}

export function createSequenceStore(
	path = getSequenceStorePath(),
): JsonFileStore<SequenceStore> {
	return {
		path,
		createDefault: () => ({
			version: SEQUENCE_STORE_VERSION,
			definitions: [],
			enrollments: [],
			workers: [],
		}),
		parse: parseStore,
		lock: { timeoutMs: 5_000 },
	};
}

export function createSequenceDefinition(
	input: CreateSequenceDefinitionInput,
	now = new Date(),
): SequenceDefinition {
	const steps = validateSequenceSteps(input.steps);
	const timestamp = now.toISOString();
	return parseSequenceDefinition({
		id: input.id ?? randomUUID(),
		name: input.name,
		description: input.description,
		status: "active",
		currentRevision: 1,
		revisions: [{ revision: 1, steps, createdAt: timestamp }],
		createdAt: timestamp,
		updatedAt: timestamp,
	});
}

export function createSequenceEnrollment(
	definition: SequenceDefinition,
	input: CreateSequenceEnrollmentInput,
	now = new Date(),
): SequenceEnrollment {
	if (definition.status !== "active") {
		throw new SequenceConflictError(
			`Cannot enroll into paused sequence: ${definition.id}`,
		);
	}
	const revision = definition.revisions.find(
		(candidate) => candidate.revision === definition.currentRevision,
	);
	const firstStep = revision?.steps[0];
	if (!revision || !firstStep) {
		throw new SequenceConflictError(
			`Sequence ${definition.id} has no executable current revision`,
		);
	}
	const timestamp = now.toISOString();
	return parseSequenceEnrollment({
		id: input.id ?? randomUUID(),
		sequenceId: definition.id,
		revision: revision.revision,
		subscriberId: input.subscriberId,
		context: input.context ?? {},
		status: "pending",
		retryCount: 0,
		currentStepId: firstStep.id,
		nextRunAt: input.startAt ?? timestamp,
		lastTransitionAt: timestamp,
		createdAt: timestamp,
		updatedAt: timestamp,
	});
}

function getFileDefinition(
	store: SequenceStore,
	id: string,
): SequenceDefinition {
	const definition = store.definitions.find((candidate) => candidate.id === id);
	if (!definition) {
		throw new SequenceNotFoundError("definition", id);
	}
	return definition;
}

function getFileEnrollment(
	store: SequenceStore,
	id: string,
): SequenceEnrollment {
	const enrollment = store.enrollments.find((candidate) => candidate.id === id);
	if (!enrollment) {
		throw new SequenceNotFoundError("enrollment", id);
	}
	return enrollment;
}

function replaceById<T extends { readonly id: string }>(
	items: readonly T[],
	value: T,
): readonly T[] {
	return items.map((candidate) =>
		candidate.id === value.id ? value : candidate,
	);
}

export function canonicalJsonValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(canonicalJsonValue);
	}
	if (value !== null && typeof value === "object") {
		const record = value as Record<string, unknown>;
		return Object.fromEntries(
			Object.keys(record)
				.sort()
				.map((key) => [key, canonicalJsonValue(record[key])]),
		);
	}
	return value;
}

export function canonicalStepsJson(steps: readonly SequenceStep[]): string {
	return JSON.stringify(
		steps.map((step) => {
			const record = step as unknown as Record<string, unknown>;
			return Object.fromEntries(
				Object.keys(record)
					.sort()
					.map((key) => [key, canonicalJsonValue(record[key])]),
			);
		}),
	);
}

function enrollmentIsTerminal(status: SequenceEnrollmentStatus): boolean {
	return ["completed", "failed", "cancelled"].includes(status);
}

function compareByCreatedAtThenId(
	left: Readonly<{ createdAt: string; id: string }>,
	right: Readonly<{ createdAt: string; id: string }>,
): number {
	const createdAtDifference =
		Date.parse(left.createdAt) - Date.parse(right.createdAt);
	if (createdAtDifference !== 0) {
		return createdAtDifference;
	}
	return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function createFileSequenceRepository(
	path = getSequenceStorePath(),
): SequenceRepository {
	const store = createSequenceStore(path);
	return {
		kind: "file",
		async listDefinitions() {
			return [...(await readJsonFileStore(store)).definitions].sort(
				compareByCreatedAtThenId,
			);
		},
		async getDefinition(id) {
			return getFileDefinition(await readJsonFileStore(store), id);
		},
		async createDefinition(definition) {
			const validatedDefinition = parseSequenceDefinition(definition);
			return updateJsonFileStore(store, (current) => {
				if (
					current.definitions.some(
						(candidate) =>
							candidate.id === validatedDefinition.id ||
							candidate.name.toLowerCase() ===
								validatedDefinition.name.toLowerCase(),
					)
				) {
					throw new SequenceConflictError(
						`Sequence ID or name already exists: ${validatedDefinition.name}`,
					);
				}
				return commitJsonFileStoreUpdate(
					{
						...current,
						definitions: [...current.definitions, validatedDefinition],
					},
					validatedDefinition,
				);
			});
		},
		async updateDefinition(id, input, now) {
			return updateJsonFileStore(store, (current) => {
				const previous = getFileDefinition(current, id);
				if (
					input.name !== undefined &&
					current.definitions.some(
						(candidate) =>
							candidate.id !== id &&
							candidate.name.toLowerCase() === input.name?.toLowerCase(),
					)
				) {
					throw new SequenceConflictError(
						`Sequence name already exists: ${input.name}`,
					);
				}
				const steps = validateSequenceSteps(input.steps);
				// An identical update is already applied when the resolved
				// name and description match and the latest revision carries
				// the requested steps: repeating it is a documented no-op
				// instead of a duplicate equivalent revision.
				const latestRevision = [...previous.revisions]
					.sort((left, right) => right.revision - left.revision)
					.at(0);
				const alreadyApplied =
					(input.name === undefined || previous.name === input.name) &&
					(input.description === undefined ||
						(previous.description ?? undefined) ===
							(input.description ?? undefined)) &&
					latestRevision !== undefined &&
					canonicalStepsJson(latestRevision.steps) ===
						canonicalStepsJson(steps);
				if (alreadyApplied) {
					const noOpResult: SequenceUpdateResult = {
						definition: previous,
						updated: false,
					};
					return commitJsonFileStoreUpdate(current, noOpResult);
				}
				const revision = previous.currentRevision + 1;
				const updated = parsePersistedSequenceDefinition({
					...previous,
					name: input.name ?? previous.name,
					description: input.description ?? previous.description,
					currentRevision: revision,
					revisions: [
						...previous.revisions,
						{ revision, steps, createdAt: now.toISOString() },
					],
					updatedAt: now.toISOString(),
				});
				const updatedResult: SequenceUpdateResult = {
					definition: updated,
					updated: true,
				};
				return commitJsonFileStoreUpdate(
					{
						...current,
						definitions: replaceById(current.definitions, updated),
					},
					updatedResult,
				);
			});
		},
		async deleteDefinition(id) {
			return updateJsonFileStore(store, (current) => {
				const definition = getFileDefinition(current, id);
				const activeEnrollment = current.enrollments.find(
					(enrollment) =>
						enrollment.sequenceId === id &&
						!enrollmentIsTerminal(enrollment.status),
				);
				if (activeEnrollment) {
					throw new SequenceConflictError(
						`Sequence ${id} still has non-terminal enrollments`,
					);
				}
				return commitJsonFileStoreUpdate(
					{
						...current,
						definitions: current.definitions.filter(
							(candidate) => candidate.id !== id,
						),
						enrollments: current.enrollments.filter(
							(enrollment) => enrollment.sequenceId !== id,
						),
					},
					definition,
				);
			});
		},
		async setDefinitionStatus(id, status, now) {
			return updateJsonFileStore(store, (current) => {
				const previous = getFileDefinition(current, id);
				// Short-circuit when the definition is already in the target
				// status so a pause/resume retry is a true no-op and does not
				// advance updatedAt, matching the spec's allowNoopFromTarget.
				if (previous.status === status) {
					return commitJsonFileStoreUpdate(current, previous);
				}
				const updated = parsePersistedSequenceDefinition({
					...previous,
					status,
					updatedAt: now.toISOString(),
				});
				return commitJsonFileStoreUpdate(
					{
						...current,
						definitions: replaceById(current.definitions, updated),
					},
					updated,
				);
			});
		},
		async listEnrollments(options = {}) {
			const limit = options.limit ?? 100;
			return [...(await readJsonFileStore(store)).enrollments]
				.filter(
					(enrollment) =>
						(options.sequenceId === undefined ||
							enrollment.sequenceId === options.sequenceId) &&
						(options.status === undefined ||
							enrollment.status === options.status) &&
						(options.subscriberId === undefined ||
							enrollment.subscriberId === options.subscriberId),
				)
				.sort(compareByCreatedAtThenId)
				.slice(0, limit);
		},
		async getEnrollment(id) {
			return getFileEnrollment(await readJsonFileStore(store), id);
		},
		async createEnrollment(enrollment) {
			return updateJsonFileStore(store, (current) => {
				getFileDefinition(current, enrollment.sequenceId);
				if (
					current.enrollments.some(
						(candidate) =>
							candidate.id === enrollment.id ||
							(candidate.sequenceId === enrollment.sequenceId &&
								candidate.subscriberId === enrollment.subscriberId &&
								!enrollmentIsTerminal(candidate.status)),
					)
				) {
					throw new SequenceConflictError(
						`Subscriber ${enrollment.subscriberId} already has an active enrollment for sequence ${enrollment.sequenceId}`,
					);
				}
				return commitJsonFileStoreUpdate(
					{
						...current,
						enrollments: [...current.enrollments, enrollment],
					},
					enrollment,
				);
			});
		},
		async claimDue(options) {
			return updateJsonFileStore(store, (current) => {
				const nowMs = options.now.getTime();
				const claimed: ClaimedSequenceEnrollment[] = [];
				let enrollments = [...current.enrollments];
				const candidates = [...current.enrollments].sort(
					(left, right) =>
						Date.parse(left.nextRunAt) - Date.parse(right.nextRunAt),
				);
				for (const candidate of candidates) {
					if (claimed.length >= options.limit) {
						break;
					}
					if (
						!["pending", "running", "waiting"].includes(candidate.status) ||
						new Date(candidate.nextRunAt).getTime() > nowMs ||
						(candidate.leaseExpiresAt !== undefined &&
							new Date(candidate.leaseExpiresAt).getTime() > nowMs)
					) {
						continue;
					}
					const definition = current.definitions.find(
						(item) => item.id === candidate.sequenceId,
					);
					if (!definition || definition.status !== "active") {
						continue;
					}
					const revision = definition.revisions.find(
						(item) => item.revision === candidate.revision,
					);
					if (!revision) {
						continue;
					}
					const leased = parseSequenceEnrollment({
						...candidate,
						status: "running",
						leaseToken: randomUUID(),
						leaseExpiresAt: new Date(
							nowMs + options.leaseMs,
						).toISOString(),
						updatedAt: options.now.toISOString(),
					});
					enrollments = replaceById(enrollments, leased) as SequenceEnrollment[];
					claimed.push({ enrollment: leased, definition, revision });
				}
				return commitJsonFileStoreUpdate(
					{ ...current, enrollments },
					claimed,
				);
			});
		},
		async claimSpecific(options) {
			return updateJsonFileStore(store, (current) => {
				const nowMs = options.now.getTime();
				const claimed: ClaimedSequenceEnrollment[] = [];
				let enrollments = [...current.enrollments];
				const byId = new Map(current.enrollments.map((e) => [e.id, e]));
				const seen = new Set<string>();
				for (const requested of options.claims) {
					if (seen.has(requested.id)) {
						continue;
					}
					seen.add(requested.id);
					const candidate = byId.get(requested.id);
					if (!candidate) {
						throw new Error(
							`Sequence enrollment ${requested.id} from the echoed claim set no longer exists`,
						);
					}
					// Bind recovery to the originally claimed step: an
					// enrollment that already advanced executes a different
					// step now, so it must be skipped, not re-executed.
					if (candidate.currentStepId !== requested.stepId) {
						continue;
					}
					if (
						!["pending", "running", "waiting"].includes(candidate.status) ||
						new Date(candidate.nextRunAt).getTime() > nowMs ||
						(candidate.leaseExpiresAt !== undefined &&
							new Date(candidate.leaseExpiresAt).getTime() > nowMs)
					) {
						continue;
					}
					const definition = current.definitions.find(
						(item) => item.id === candidate.sequenceId,
					);
					if (!definition || definition.status !== "active") {
						continue;
					}
					const revision = definition.revisions.find(
						(item) => item.revision === candidate.revision,
					);
					if (!revision) {
						continue;
					}
					const leased = parseSequenceEnrollment({
						...candidate,
						status: "running",
						leaseToken: randomUUID(),
						leaseExpiresAt: new Date(
							nowMs + options.leaseMs,
						).toISOString(),
						updatedAt: options.now.toISOString(),
					});
					enrollments = replaceById(enrollments, leased) as SequenceEnrollment[];
					claimed.push({ enrollment: leased, definition, revision });
				}
				return commitJsonFileStoreUpdate(
					{ ...current, enrollments },
					claimed,
				);
			});
		},
		async completeClaim(enrollment, next) {
			return updateJsonFileStore(store, (current) => {
				const stored = getFileEnrollment(current, enrollment.id);
				if (
					stored.leaseToken === undefined ||
					stored.leaseToken !== enrollment.leaseToken
				) {
					throw new SequenceConflictError(
						`Sequence enrollment lease was lost: ${enrollment.id}`,
					);
				}
				const completed = parseSequenceEnrollment(next);
				return commitJsonFileStoreUpdate(
					{
						...current,
						enrollments: replaceById(current.enrollments, completed),
					},
					completed,
				);
			});
		},
		async resolveAmbiguous(enrollment, next) {
			return updateJsonFileStore(store, (current) => {
				const stored = getFileEnrollment(current, enrollment.id);
				if (
					stored.status !== "ambiguous" ||
					stored.updatedAt !== enrollment.updatedAt
				) {
					throw new SequenceConflictError(
						`Sequence enrollment changed before reconciliation: ${enrollment.id}`,
					);
				}
				const resolved = parseSequenceEnrollment(next);
				return commitJsonFileStoreUpdate(
					{
						...current,
						enrollments: replaceById(current.enrollments, resolved),
					},
					resolved,
				);
			});
		},
		async reconcile(options) {
			return updateJsonFileStore(store, (current) => {
				const bounded = options.enrollmentIds
					? new Set(options.enrollmentIds)
					: undefined;
				const expired = current.enrollments
					.filter(
						(enrollment) =>
							enrollment.leaseExpiresAt !== undefined &&
							new Date(enrollment.leaseExpiresAt).getTime() <=
								options.now.getTime() &&
							!enrollmentIsTerminal(enrollment.status) &&
							(bounded === undefined || bounded.has(enrollment.id)),
					)
					.slice(0, options.limit);
				if (options.dryRun) {
					const result: SequenceReconcileResult = {
						scannedIds: expired.map((entry) => entry.id),
					scanned: expired.length,
						recovered: expired.length,
						unchanged: 0,
						dryRun: true,
					};
					return commitJsonFileStoreUpdate(current, result);
				}
				const expiredIds = new Set(expired.map((entry) => entry.id));
				const enrollments = current.enrollments.map((enrollment) =>
					expiredIds.has(enrollment.id)
						? parseSequenceEnrollment({
								...enrollment,
								status: "pending",
								leaseToken: undefined,
								leaseExpiresAt: undefined,
								nextRunAt: options.now.toISOString(),
								updatedAt: options.now.toISOString(),
							})
						: enrollment,
				);
				const result: SequenceReconcileResult = {
					scannedIds: expired.map((entry) => entry.id),
					scanned: expired.length,
					recovered: expired.length,
					unchanged: 0,
					dryRun: false,
				};
				return commitJsonFileStoreUpdate(
					{ ...current, enrollments },
					result,
				);
			});
		},
		async getRuntimeHealth(options) {
			const current = await readJsonFileStore(store);
			return buildSequenceRuntimeHealth(
				"file",
				current.definitions,
				current.enrollments,
				current.workers,
				options,
			);
		},
		async upsertWorker(worker) {
			await updateJsonFileStore(store, (current) => {
				const cutoff =
					Date.parse(worker.heartbeatAt) -
					DEFAULT_SEQUENCE_WORKER_RETENTION_MS;
				const retainedWorkers = current.workers.filter(
					(candidate) =>
						candidate.id === worker.id ||
						Date.parse(candidate.heartbeatAt) >= cutoff,
				);
				const exists = retainedWorkers.some(
					(candidate) => candidate.id === worker.id,
				);
				return commitJsonFileStoreUpdate(
					{
						...current,
						workers: exists
							? replaceById(retainedWorkers, worker)
							: [...retainedWorkers, worker],
					},
					undefined,
				);
			});
		},
	};
}

export function buildSequenceRuntimeHealth(
	kind: "file" | "postgres",
	definitions: readonly SequenceDefinition[],
	enrollments: readonly SequenceEnrollment[],
	workers: readonly SequenceWorker[],
	options: Readonly<{ now: Date; workerStaleMs: number }>,
): SequenceRuntimeHealth {
	const nowMs = options.now.getTime();
	const enrollmentCounts = Object.fromEntries(
		sequenceEnrollmentStatusSchema.options.map((status) => [
			status,
			enrollments.filter((entry) => entry.status === status).length,
		]),
	) as Record<SequenceEnrollmentStatus, number>;
	const dueEnrollments = enrollments.filter(
		(entry) =>
			["pending", "running", "waiting"].includes(entry.status) &&
			new Date(entry.nextRunAt).getTime() <= nowMs &&
			(entry.leaseExpiresAt === undefined ||
				new Date(entry.leaseExpiresAt).getTime() <= nowMs),
	);
	const activeWorkers = workers.filter((worker) => worker.status === "running");
	const staleWorkers = activeWorkers.filter(
		(worker) =>
			nowMs - new Date(worker.heartbeatAt).getTime() > options.workerStaleMs,
	);
	const heartbeatTimes = workers
		.map((worker) => worker.heartbeatAt)
		.sort((left, right) => Date.parse(left) - Date.parse(right));
	const lastHeartbeatAt = heartbeatTimes.at(-1);
	return {
		store: kind,
		schemaVersion: SEQUENCE_STORE_VERSION,
		healthy:
			enrollments.every(
				(entry) =>
					!entry.leaseExpiresAt ||
					Number.isFinite(new Date(entry.leaseExpiresAt).getTime()),
			) &&
			staleWorkers.length === 0 &&
			(dueEnrollments.length === 0 ||
				activeWorkers.length > staleWorkers.length),
		checkedAt: options.now.toISOString(),
		definitions: {
			total: definitions.length,
			active: definitions.filter((entry) => entry.status === "active").length,
			paused: definitions.filter((entry) => entry.status === "paused").length,
		},
		enrollments: {
			...enrollmentCounts,
			due: dueEnrollments.length,
			leased: enrollments.filter(
				(entry) =>
					entry.leaseExpiresAt !== undefined &&
					new Date(entry.leaseExpiresAt).getTime() > nowMs,
			).length,
			oldestDueAt: dueEnrollments
				.map((entry) => entry.nextRunAt)
				.sort((left, right) => Date.parse(left) - Date.parse(right))
				.at(0),
		},
		workers: {
			running: activeWorkers.length,
			stale: staleWorkers.length,
			stopped: workers.filter((worker) => worker.status === "stopped").length,
			failed: workers.filter((worker) => worker.status === "failed").length,
			lastHeartbeatAt,
		},
	};
}
