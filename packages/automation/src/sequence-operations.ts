import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	defineOperation,
	defineOperationCatalog,
	normalizeOperationExecutionError,
	parseOperationInput,
	parseOperationOutput,
	transactionalSubjectSchema,
	type TransactionalIdempotencyStore,
} from "@listmonk-ops/operations";
import { createHash } from "node:crypto";
import {
	bindSequenceCreateOperationSpec,
	bindSequenceDeleteOperationSpec,
	bindSequenceEnrollOperationSpec,
	bindSequenceEnrollmentGetOperationSpec,
	bindSequenceEnrollmentListOperationSpec,
	bindSequenceGetOperationSpec,
	bindSequenceListOperationSpec,
	bindSequencePauseOperationSpec,
	bindSequenceReconcileOperationSpec,
	bindSequenceResumeOperationSpec,
	bindSequenceStatusOperationSpec,
	bindSequenceTickOperationSpec,
	bindSequenceUpdateOperationSpec,
	bindSequenceValidateOperationSpec,
} from "@listmonk-ops/operations/specs";
import { z } from "zod";
import {
	reconcileAmbiguousSequenceEnrollment,
	runSequenceTick,
	type SequenceExecutionContext,
} from "./sequence-engine";
import { getSequenceRepositoryFromEnvironment } from "./sequence-runtime";
import {
	createSequenceDefinition,
	createSequenceEnrollment,
	SEQUENCE_STEP_TYPES,
	sequenceEnrollmentStatusSchema,
	type SequenceDefinition,
	type SequenceEnrollment,
	type SequenceRepository,
	type SequenceStep,
	validateSequenceSteps,
} from "./sequences";

export interface SequenceOperationContext {
	repository?: SequenceRepository;
	client?: Pick<ListmonkClient, "subscriber" | "transactional">;
	idempotencyStore?: TransactionalIdempotencyStore;
	hashPayload?: (serialized: string) => string;
	target?: {
		baseUrl?: string;
		username?: string;
	};
	now?: () => Date;
}

const booleanInput = z.preprocess((value: unknown) => {
	if (typeof value !== "string") {
		return value;
	}
	if (value.toLowerCase() === "true") {
		return true;
	}
	if (value.toLowerCase() === "false") {
		return false;
	}
	return value;
}, z.boolean());
const positiveIntegerInput = z.preprocess(
	(value: unknown) =>
		value === null || value === "" || typeof value === "boolean"
			? Number.NaN
			: value,
	z.coerce.number().int().positive(),
);
const isoDateTimeInput = z.iso.datetime({ offset: true });
const sequenceIdInput = z.uuid();
const stepIdInput = z
	.string()
	.trim()
	.min(1)
	.max(80)
	.regex(/^[A-Za-z0-9._:-]+$/);
const conditionPathSchema = z
	.string()
	.trim()
	.min(1)
	.max(200)
	.regex(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/);
const contentTypeSchema = z.enum(["html", "markdown", "plain"]);

function buildSequenceStepSchema(
	templateIdSchema: z.ZodType<number>,
	durationSecondsSchema: z.ZodType<number>,
) {
	return z.discriminatedUnion("type", [
		z.object({
			id: stepIdInput,
			type: z.literal("send"),
			template_id: templateIdSchema,
			from_email: z.string().trim().min(1).optional(),
			data: z.record(z.string(), z.unknown()).optional(),
			content_type: contentTypeSchema.optional(),
			messenger: z.string().trim().min(1).optional(),
			subject: transactionalSubjectSchema.optional(),
			altbody: z.string().min(1).optional(),
		}),
		z.object({
			id: stepIdInput,
			type: z.literal("wait"),
			duration_seconds: durationSecondsSchema,
		}),
		z.object({
			id: stepIdInput,
			type: z.literal("wait_until"),
			at: isoDateTimeInput,
		}),
		z.object({
			id: stepIdInput,
			type: z.literal("condition"),
			path: conditionPathSchema,
			operator: z.enum(["equals", "not_equals", "exists"]),
			value: z.unknown().optional(),
			on_true: stepIdInput,
			on_false: stepIdInput,
		}),
		z.object({
			id: stepIdInput,
			type: z.literal("stop"),
		}),
	]);
}

const sequenceStepInputSchema = buildSequenceStepSchema(
	positiveIntegerInput,
	positiveIntegerInput.refine(
		(value) => value <= 31_536_000,
		"duration_seconds must be no greater than one year",
	),
);

const sequenceValidateInputSchema = z.object({
	steps: z.array(sequenceStepInputSchema).min(1),
});
const sequenceCreateInputSchema = z.object({
	name: z.string().trim().min(1).max(120),
	description: z.string().trim().max(500).optional(),
	steps: z.array(sequenceStepInputSchema).min(1),
});
const sequenceUpdateInputSchema = z.object({
	id: sequenceIdInput,
	name: z.string().trim().min(1).max(120).optional(),
	description: z.string().trim().max(500).optional(),
	steps: z.array(sequenceStepInputSchema).min(1),
});
const sequenceListInputSchema = z.object({
	status: z.enum(["active", "paused"]).optional(),
});
const sequenceGetInputSchema = z.object({ id: sequenceIdInput });
const sequenceDeleteInputSchema = sequenceGetInputSchema;
const sequenceEnrollInputSchema = z.object({
	id: sequenceIdInput,
	subscriber_id: positiveIntegerInput,
	context: z.record(z.string(), z.unknown()).default({}),
	start_at: isoDateTimeInput.optional(),
});
const sequenceEnrollmentStatusInput = sequenceEnrollmentStatusSchema;
const sequenceEnrollmentListInputSchema = z.object({
	sequence_id: sequenceIdInput.optional(),
	subscriber_id: positiveIntegerInput.optional(),
	status: sequenceEnrollmentStatusInput.optional(),
	limit: positiveIntegerInput
		.refine((value) => value <= 1_000, "limit must be at most 1000")
		.default(100),
});
const sequenceEnrollmentGetInputSchema = z.object({ id: sequenceIdInput });
const sequencePauseInputSchema = sequenceGetInputSchema;
const sequenceResumeInputSchema = sequenceGetInputSchema;
const sequenceTickInputSchema = z.object({
	limit: positiveIntegerInput
		.refine((value) => value <= 100, "limit must be between 1 and 100")
		.default(25),
	lease_ms: positiveIntegerInput
		.refine(
			(value) => value >= 1_000 && value <= 900_000,
			"lease_ms must be between 1000 and 900000",
		)
		.default(90_000),
});
const sequenceReconcileInputSchema = z
	.object({
		enrollment_id: sequenceIdInput.optional(),
		resolution: z.enum(["sent", "not_sent"]).optional(),
		limit: positiveIntegerInput
			.refine((value) => value <= 1_000, "limit must be at most 1000")
			.default(100),
		dry_run: booleanInput.default(true),
	})
	.superRefine((value, context) => {
		if (
			(value.enrollment_id === undefined) !==
			(value.resolution === undefined)
		) {
			context.addIssue({
				code: "custom",
				message:
					"enrollment_id and resolution must be provided together for ambiguous-send reconciliation",
			});
		}
		if (value.enrollment_id !== undefined && value.dry_run) {
			context.addIssue({
				code: "custom",
				path: ["dry_run"],
				message:
					"Ambiguous-send reconciliation requires dry_run=false after the delivery outcome is reviewed",
			});
		}
	});
const sequenceStatusInputSchema = z.object({
	worker_stale_ms: positiveIntegerInput
		.refine(
			(value) => value >= 1_000 && value <= 86_400_000,
			"worker_stale_ms must be between 1000 and 86400000",
		)
		.default(90_000),
});

const sequenceRevisionOutputSchema = z.object({
	revision: z.number().int().positive(),
	step_count: z.number().int().positive(),
	step_types: z.array(z.enum(SEQUENCE_STEP_TYPES)).min(1),
	content_fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
	created_at: isoDateTimeInput,
});
const sequenceDefinitionOutputSchema = z.object({
	id: sequenceIdInput,
	name: z.string().min(1).max(120),
	description_present: z.boolean(),
	status: z.enum(["active", "paused"]),
	current_revision: z.number().int().positive(),
	revisions: z.array(sequenceRevisionOutputSchema).min(1),
	created_at: isoDateTimeInput,
	updated_at: isoDateTimeInput,
});
const sequenceEnrollmentOutputSchema = z.object({
	id: sequenceIdInput,
	sequence_id: sequenceIdInput,
	revision: z.number().int().positive(),
	subscriber_reference_present: z.literal(true),
	status: sequenceEnrollmentStatusInput,
	retry_count: z.number().int().nonnegative(),
	current_step_id: stepIdInput,
	next_run_at: isoDateTimeInput,
	last_error_present: z.boolean(),
	created_at: isoDateTimeInput,
	updated_at: isoDateTimeInput,
});
const sequenceValidateOutputSchema = z.object({
	valid: z.literal(true),
	step_count: z.number().int().positive(),
	step_ids: z.array(stepIdInput),
});
const sequenceDefinitionEnvelopeSchema = z.object({
	sequence: sequenceDefinitionOutputSchema,
});
const sequenceListOutputSchema = z.object({
	sequences: z.array(sequenceDefinitionOutputSchema),
});
const sequenceDeleteOutputSchema = z.object({
	deleted: z.literal(true),
	sequence: sequenceDefinitionOutputSchema,
});
const sequenceEnrollmentEnvelopeSchema = z.object({
	enrollment: sequenceEnrollmentOutputSchema,
});
const sequenceEnrollmentListOutputSchema = z.object({
	enrollments: z.array(sequenceEnrollmentOutputSchema),
});
const sequenceTickOutputSchema = z.object({
	claimed: z.number().int().nonnegative(),
	advanced: z.number().int().nonnegative(),
	waiting: z.number().int().nonnegative(),
	completed: z.number().int().nonnegative(),
	failed: z.number().int().nonnegative(),
	ambiguous: z.number().int().nonnegative(),
	cancelled: z.number().int().nonnegative(),
	completed_at: isoDateTimeInput,
});
const sequenceReconcileOutputSchema = z.object({
	scanned: z.number().int().nonnegative(),
	recovered: z.number().int().nonnegative(),
	unchanged: z.number().int().nonnegative(),
	dry_run: z.boolean(),
	enrollment: sequenceEnrollmentOutputSchema.optional(),
});
const sequenceStatusOutputSchema = z.object({
	store: z.enum(["file", "postgres"]),
	schema_version: z.number().int().positive(),
	healthy: z.boolean(),
	checked_at: isoDateTimeInput,
	definitions: z.object({
		total: z.number().int().nonnegative(),
		active: z.number().int().nonnegative(),
		paused: z.number().int().nonnegative(),
	}),
	enrollments: z.object({
		pending: z.number().int().nonnegative(),
		running: z.number().int().nonnegative(),
		waiting: z.number().int().nonnegative(),
		paused: z.number().int().nonnegative(),
		completed: z.number().int().nonnegative(),
		failed: z.number().int().nonnegative(),
		ambiguous: z.number().int().nonnegative(),
		cancelled: z.number().int().nonnegative(),
		due: z.number().int().nonnegative(),
		leased: z.number().int().nonnegative(),
		oldest_due_at: isoDateTimeInput.optional(),
	}),
	workers: z.object({
		running: z.number().int().nonnegative(),
		stale: z.number().int().nonnegative(),
		stopped: z.number().int().nonnegative(),
		failed: z.number().int().nonnegative(),
		last_heartbeat_at: isoDateTimeInput.optional(),
	}),
});

function toInternalStep(
	step: z.output<typeof sequenceStepInputSchema>,
): SequenceStep {
	switch (step.type) {
		case "send":
			return {
				id: step.id,
				type: step.type,
				templateId: step.template_id,
				fromEmail: step.from_email,
				data: step.data,
				contentType: step.content_type,
				messenger: step.messenger,
				subject: step.subject,
				altBody: step.altbody,
			};
		case "wait":
			return {
				id: step.id,
				type: step.type,
				durationSeconds: step.duration_seconds,
			};
		case "wait_until":
			return step;
		case "condition":
			return {
				id: step.id,
				type: step.type,
				path: step.path,
				operator: step.operator,
				value: step.value,
				onTrue: step.on_true,
				onFalse: step.on_false,
			};
		case "stop":
			return step;
		default:
			step satisfies never;
			throw new Error("Unsupported sequence step");
	}
}

function canonicalizeSequenceValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(canonicalizeSequenceValue);
	}
	if (value === null || typeof value !== "object") {
		return value;
	}
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(([key, nested]) => [key, canonicalizeSequenceValue(nested)]),
	);
}

function sequenceRevisionFingerprint(steps: readonly SequenceStep[]): string {
	return `sha256:${createHash("sha256")
		.update(JSON.stringify(canonicalizeSequenceValue(steps)))
		.digest("hex")}`;
}

function toDefinitionOutput(definition: SequenceDefinition) {
	return {
		id: definition.id,
		name: definition.name,
		description_present: definition.description !== undefined,
		status: definition.status,
		current_revision: definition.currentRevision,
		revisions: definition.revisions.map((revision) => ({
			revision: revision.revision,
			step_count: revision.steps.length,
			step_types: revision.steps.map(({ type }) => type),
			content_fingerprint: sequenceRevisionFingerprint(revision.steps),
			created_at: revision.createdAt,
		})),
		created_at: definition.createdAt,
		updated_at: definition.updatedAt,
	};
}

function toEnrollmentOutput(enrollment: SequenceEnrollment) {
	return {
		id: enrollment.id,
		sequence_id: enrollment.sequenceId,
		revision: enrollment.revision,
		subscriber_reference_present: true as const,
		status: enrollment.status,
		retry_count: enrollment.retryCount,
		current_step_id: enrollment.currentStepId,
		next_run_at: enrollment.nextRunAt,
		last_error_present: enrollment.lastError !== undefined,
		created_at: enrollment.createdAt,
		updated_at: enrollment.updatedAt,
	};
}

function repository(context: SequenceOperationContext): SequenceRepository {
	return context.repository ?? getSequenceRepositoryFromEnvironment();
}

function executionContext(
	context: SequenceOperationContext,
): SequenceExecutionContext {
	if (!context.client) {
		throw new Error("Sequence execution requires a Listmonk client");
	}
	const resolvedRepository = repository(context);
	const idempotencyStore =
		context.idempotencyStore ?? resolvedRepository.idempotencyStore;
	if (!idempotencyStore || !context.hashPayload) {
		throw new Error(
			"Sequence execution requires the transactional idempotency store and payload hasher",
		);
	}
	return {
		repository: resolvedRepository,
		client: context.client,
		idempotencyStore,
		hashPayload: context.hashPayload,
		target: context.target,
		now: context.now,
	};
}

export async function executeSequenceValidateOperation(
	_context: SequenceOperationContext,
	input: z.output<typeof sequenceValidateInputSchema>,
) {
	const steps = validateSequenceSteps(input.steps.map(toInternalStep));
	return {
		valid: true as const,
		step_count: steps.length,
		step_ids: steps.map((step) => step.id),
	};
}

export async function executeSequenceCreateOperation(
	context: SequenceOperationContext,
	input: z.output<typeof sequenceCreateInputSchema>,
) {
	const now = context.now?.() ?? new Date();
	const definition = createSequenceDefinition(
		{
			name: input.name,
			description: input.description,
			steps: input.steps.map(toInternalStep),
		},
		now,
	);
	const created = await repository(context).createDefinition(definition);
	return { sequence: toDefinitionOutput(created) };
}

export async function executeSequenceUpdateOperation(
	context: SequenceOperationContext,
	input: z.output<typeof sequenceUpdateInputSchema>,
) {
	const updated = await repository(context).updateDefinition(
		input.id,
		{
			name: input.name,
			description: input.description,
			steps: input.steps.map(toInternalStep),
		},
		context.now?.() ?? new Date(),
	);
	return { sequence: toDefinitionOutput(updated) };
}

export async function executeSequenceListOperation(
	context: SequenceOperationContext,
	input: z.output<typeof sequenceListInputSchema>,
) {
	const definitions = await repository(context).listDefinitions();
	return {
		sequences: definitions
			.filter(
				(definition) =>
					input.status === undefined || definition.status === input.status,
			)
			.map(toDefinitionOutput),
	};
}

export async function executeSequenceGetOperation(
	context: SequenceOperationContext,
	input: z.output<typeof sequenceGetInputSchema>,
) {
	const definition = await repository(context).getDefinition(input.id);
	return { sequence: toDefinitionOutput(definition) };
}

export async function executeSequenceDeleteOperation(
	context: SequenceOperationContext,
	input: z.output<typeof sequenceDeleteInputSchema>,
) {
	const definition = await repository(context).deleteDefinition(input.id);
	return { deleted: true as const, sequence: toDefinitionOutput(definition) };
}

export async function executeSequenceEnrollOperation(
	context: SequenceOperationContext,
	input: z.output<typeof sequenceEnrollInputSchema>,
) {
	const store = repository(context);
	const definition = await store.getDefinition(input.id);
	const enrollment = createSequenceEnrollment(
		definition,
		{
			sequenceId: input.id,
			subscriberId: input.subscriber_id,
			context: input.context,
			startAt: input.start_at,
		},
		context.now?.() ?? new Date(),
	);
	const created = await store.createEnrollment(enrollment);
	return { enrollment: toEnrollmentOutput(created) };
}

export async function executeSequenceEnrollmentListOperation(
	context: SequenceOperationContext,
	input: z.output<typeof sequenceEnrollmentListInputSchema>,
) {
	const enrollments = await repository(context).listEnrollments({
		sequenceId: input.sequence_id,
		subscriberId: input.subscriber_id,
		status: input.status,
		limit: input.limit,
	});
	return { enrollments: enrollments.map(toEnrollmentOutput) };
}

export async function executeSequenceEnrollmentGetOperation(
	context: SequenceOperationContext,
	input: z.output<typeof sequenceEnrollmentGetInputSchema>,
) {
	const enrollment = await repository(context).getEnrollment(input.id);
	return { enrollment: toEnrollmentOutput(enrollment) };
}

export async function executeSequencePauseOperation(
	context: SequenceOperationContext,
	input: z.output<typeof sequencePauseInputSchema>,
) {
	const definition = await repository(context).setDefinitionStatus(
		input.id,
		"paused",
		context.now?.() ?? new Date(),
	);
	return { sequence: toDefinitionOutput(definition) };
}

export async function executeSequenceResumeOperation(
	context: SequenceOperationContext,
	input: z.output<typeof sequenceResumeInputSchema>,
) {
	const definition = await repository(context).setDefinitionStatus(
		input.id,
		"active",
		context.now?.() ?? new Date(),
	);
	return { sequence: toDefinitionOutput(definition) };
}

export async function executeSequenceTickOperation(
	context: SequenceOperationContext,
	input: z.output<typeof sequenceTickInputSchema>,
) {
	const result = await runSequenceTick(executionContext(context), {
		limit: input.limit,
		leaseMs: input.lease_ms,
	});
	return {
		claimed: result.claimed,
		advanced: result.advanced,
		waiting: result.waiting,
		completed: result.completed,
		failed: result.failed,
		ambiguous: result.ambiguous,
		cancelled: result.cancelled,
		completed_at: result.completedAt,
	};
}

export async function executeSequenceReconcileOperation(
	context: SequenceOperationContext,
	input: z.output<typeof sequenceReconcileInputSchema>,
) {
	if (input.enrollment_id && input.resolution) {
		const enrollment = await reconcileAmbiguousSequenceEnrollment(
			executionContext(context),
			input.enrollment_id,
			input.resolution,
		);
		return {
			scanned: 1,
			recovered: 1,
			unchanged: 0,
			dry_run: false,
			enrollment: toEnrollmentOutput(enrollment),
		};
	}
	const result = await repository(context).reconcile({
		now: context.now?.() ?? new Date(),
		limit: input.limit,
		dryRun: input.dry_run,
	});
	return {
		scanned: result.scanned,
		recovered: result.recovered,
		unchanged: result.unchanged,
		dry_run: result.dryRun,
	};
}

export async function executeSequenceStatusOperation(
	context: SequenceOperationContext,
	input: z.output<typeof sequenceStatusInputSchema>,
) {
	const health = await repository(context).getRuntimeHealth({
		now: context.now?.() ?? new Date(),
		workerStaleMs: input.worker_stale_ms,
	});
	return {
		store: health.store,
		schema_version: health.schemaVersion,
		healthy: health.healthy,
		checked_at: health.checkedAt,
		definitions: health.definitions,
		enrollments: {
			...health.enrollments,
			oldest_due_at: health.enrollments.oldestDueAt,
		},
		workers: {
			...health.workers,
			last_heartbeat_at: health.workers.lastHeartbeatAt,
		},
	};
}

export const sequenceValidateOperation = defineOperation({
	id: "sequences.validate",
	title: "Validate sequence definition",
	description:
		"Validate typed send, wait, wait-until, condition, and stop steps without persisting a sequence.",
	inputSchema: sequenceValidateInputSchema,
	outputSchema: sequenceValidateOutputSchema,
	safety: {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_sequences_validate" },
	spec: bindSequenceValidateOperationSpec(),
	execute: executeSequenceValidateOperation,
});
export const sequenceCreateOperation = defineOperation({
	id: "sequences.create",
	title: "Create sequence",
	description: "Create an active sequence with an immutable first revision.",
	inputSchema: sequenceCreateInputSchema,
	outputSchema: sequenceDefinitionEnvelopeSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: false,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_sequences_create" },
	spec: bindSequenceCreateOperationSpec(),
	execute: executeSequenceCreateOperation,
});
export const sequenceUpdateOperation = defineOperation({
	id: "sequences.update",
	title: "Create sequence revision",
	description:
		"Append an immutable revision while existing enrollments stay pinned to their original revision.",
	inputSchema: sequenceUpdateInputSchema,
	outputSchema: sequenceDefinitionEnvelopeSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: false,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_sequences_update" },
	spec: bindSequenceUpdateOperationSpec(),
	execute: executeSequenceUpdateOperation,
});
export const sequenceListOperation = defineOperation({
	id: "sequences.list",
	title: "List sequences",
	description: "List redacted sequence definitions and revision summaries.",
	inputSchema: sequenceListInputSchema,
	outputSchema: sequenceListOutputSchema,
	safety: {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_sequences_list" },
	spec: bindSequenceListOperationSpec(),
	execute: executeSequenceListOperation,
});
export const sequenceGetOperation = defineOperation({
	id: "sequences.get",
	title: "Get sequence",
	description:
		"Get one redacted sequence definition with immutable revision summaries.",
	inputSchema: sequenceGetInputSchema,
	outputSchema: sequenceDefinitionEnvelopeSchema,
	safety: {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_sequences_get" },
	spec: bindSequenceGetOperationSpec(),
	execute: executeSequenceGetOperation,
});
export const sequenceDeleteOperation = defineOperation({
	id: "sequences.delete",
	title: "Delete sequence",
	description:
		"Delete a sequence only after all of its enrollments have reached terminal states.",
	inputSchema: sequenceDeleteInputSchema,
	outputSchema: sequenceDeleteOutputSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: false,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_sequences_delete" },
	spec: bindSequenceDeleteOperationSpec(),
	execute: executeSequenceDeleteOperation,
});
export const sequenceEnrollOperation = defineOperation({
	id: "sequences.enroll",
	title: "Enroll subscriber in sequence",
	description:
		"Pin one subscriber to the current immutable sequence revision and schedule its first step.",
	inputSchema: sequenceEnrollInputSchema,
	outputSchema: sequenceEnrollmentEnvelopeSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: false,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_sequences_enroll" },
	spec: bindSequenceEnrollOperationSpec(),
	execute: executeSequenceEnrollOperation,
});
export const sequenceEnrollmentListOperation = defineOperation({
	id: "sequences.enrollments.list",
	title: "List sequence enrollments",
	description:
		"List redacted sequence enrollments so operators can discover pending, failed, or ambiguous work.",
	inputSchema: sequenceEnrollmentListInputSchema,
	outputSchema: sequenceEnrollmentListOutputSchema,
	safety: {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_sequences_enrollments_list" },
	spec: bindSequenceEnrollmentListOperationSpec(),
	execute: executeSequenceEnrollmentListOperation,
});
export const sequenceEnrollmentGetOperation = defineOperation({
	id: "sequences.enrollments.get",
	title: "Get sequence enrollment",
	description:
		"Get one redacted sequence enrollment including its current step, status, and error presence.",
	inputSchema: sequenceEnrollmentGetInputSchema,
	outputSchema: sequenceEnrollmentEnvelopeSchema,
	safety: {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_sequences_enrollments_get" },
	spec: bindSequenceEnrollmentGetOperationSpec(),
	execute: executeSequenceEnrollmentGetOperation,
});
export const sequencePauseOperation = defineOperation({
	id: "sequences.pause",
	title: "Pause sequence",
	description:
		"Pause new enrollment execution while preserving durable enrollment state.",
	inputSchema: sequencePauseInputSchema,
	outputSchema: sequenceDefinitionEnvelopeSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_sequences_pause" },
	spec: bindSequencePauseOperationSpec(),
	execute: executeSequencePauseOperation,
});
export const sequenceResumeOperation = defineOperation({
	id: "sequences.resume",
	title: "Resume sequence",
	description: "Resume claiming due enrollments for a paused sequence.",
	inputSchema: sequenceResumeInputSchema,
	outputSchema: sequenceDefinitionEnvelopeSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_sequences_resume" },
	spec: bindSequenceResumeOperationSpec(),
	execute: executeSequenceResumeOperation,
});
export const sequenceTickOperation = defineOperation({
	id: "sequences.tick",
	title: "Run sequence worker tick",
	description:
		"Claim a bounded due-enrollment batch and execute one typed step per enrollment.",
	inputSchema: sequenceTickInputSchema,
	outputSchema: sequenceTickOutputSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: false,
		openWorldHint: true,
	},
	mcp: { name: "listmonk_sequences_tick" },
	spec: bindSequenceTickOperationSpec(),
	execute: executeSequenceTickOperation,
});
export const sequenceReconcileOperation = defineOperation({
	id: "sequences.reconcile",
	title: "Reconcile sequence runtime",
	description:
		"Preview or recover expired enrollment leases, or explicitly resolve one ambiguous send.",
	inputSchema: sequenceReconcileInputSchema,
	outputSchema: sequenceReconcileOutputSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: false,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_sequences_reconcile" },
	spec: bindSequenceReconcileOperationSpec(),
	execute: executeSequenceReconcileOperation,
});
export const sequenceStatusOperation = defineOperation({
	id: "sequences.status",
	title: "Inspect sequence runtime health",
	description:
		"Inspect durable schema, definitions, enrollment states, due work, leases, and worker heartbeats.",
	inputSchema: sequenceStatusInputSchema,
	outputSchema: sequenceStatusOutputSchema,
	safety: {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_sequences_status" },
	spec: bindSequenceStatusOperationSpec(),
	execute: executeSequenceStatusOperation,
});

export async function invokeSequenceValidateOperation(
	context: SequenceOperationContext,
	input: unknown,
) {
	const parsed = parseOperationInput(
		sequenceValidateOperation.inputSchema,
		input,
	);
	try {
		return parseOperationOutput(
			sequenceValidateOperation.id,
			sequenceValidateOperation.outputSchema,
			await executeSequenceValidateOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(sequenceValidateOperation.id, error);
	}
}

export async function invokeSequenceCreateOperation(
	context: SequenceOperationContext,
	input: unknown,
) {
	const parsed = parseOperationInput(
		sequenceCreateOperation.inputSchema,
		input,
	);
	try {
		return parseOperationOutput(
			sequenceCreateOperation.id,
			sequenceCreateOperation.outputSchema,
			await executeSequenceCreateOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(sequenceCreateOperation.id, error);
	}
}

export async function invokeSequenceUpdateOperation(
	context: SequenceOperationContext,
	input: unknown,
) {
	const parsed = parseOperationInput(
		sequenceUpdateOperation.inputSchema,
		input,
	);
	try {
		return parseOperationOutput(
			sequenceUpdateOperation.id,
			sequenceUpdateOperation.outputSchema,
			await executeSequenceUpdateOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(sequenceUpdateOperation.id, error);
	}
}

export async function invokeSequenceListOperation(
	context: SequenceOperationContext,
	input: unknown,
) {
	const parsed = parseOperationInput(sequenceListOperation.inputSchema, input);
	try {
		return parseOperationOutput(
			sequenceListOperation.id,
			sequenceListOperation.outputSchema,
			await executeSequenceListOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(sequenceListOperation.id, error);
	}
}

export async function invokeSequenceGetOperation(
	context: SequenceOperationContext,
	input: unknown,
) {
	const parsed = parseOperationInput(sequenceGetOperation.inputSchema, input);
	try {
		return parseOperationOutput(
			sequenceGetOperation.id,
			sequenceGetOperation.outputSchema,
			await executeSequenceGetOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(sequenceGetOperation.id, error);
	}
}

export async function invokeSequenceDeleteOperation(
	context: SequenceOperationContext,
	input: unknown,
) {
	const parsed = parseOperationInput(
		sequenceDeleteOperation.inputSchema,
		input,
	);
	try {
		return parseOperationOutput(
			sequenceDeleteOperation.id,
			sequenceDeleteOperation.outputSchema,
			await executeSequenceDeleteOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(sequenceDeleteOperation.id, error);
	}
}

export async function invokeSequenceEnrollOperation(
	context: SequenceOperationContext,
	input: unknown,
) {
	const parsed = parseOperationInput(
		sequenceEnrollOperation.inputSchema,
		input,
	);
	try {
		return parseOperationOutput(
			sequenceEnrollOperation.id,
			sequenceEnrollOperation.outputSchema,
			await executeSequenceEnrollOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(sequenceEnrollOperation.id, error);
	}
}

export async function invokeSequenceEnrollmentListOperation(
	context: SequenceOperationContext,
	input: unknown,
) {
	const parsed = parseOperationInput(
		sequenceEnrollmentListOperation.inputSchema,
		input,
	);
	try {
		return parseOperationOutput(
			sequenceEnrollmentListOperation.id,
			sequenceEnrollmentListOperation.outputSchema,
			await executeSequenceEnrollmentListOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(
			sequenceEnrollmentListOperation.id,
			error,
		);
	}
}

export async function invokeSequenceEnrollmentGetOperation(
	context: SequenceOperationContext,
	input: unknown,
) {
	const parsed = parseOperationInput(
		sequenceEnrollmentGetOperation.inputSchema,
		input,
	);
	try {
		return parseOperationOutput(
			sequenceEnrollmentGetOperation.id,
			sequenceEnrollmentGetOperation.outputSchema,
			await executeSequenceEnrollmentGetOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(
			sequenceEnrollmentGetOperation.id,
			error,
		);
	}
}

export async function invokeSequencePauseOperation(
	context: SequenceOperationContext,
	input: unknown,
) {
	const parsed = parseOperationInput(sequencePauseOperation.inputSchema, input);
	try {
		return parseOperationOutput(
			sequencePauseOperation.id,
			sequencePauseOperation.outputSchema,
			await executeSequencePauseOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(sequencePauseOperation.id, error);
	}
}

export async function invokeSequenceResumeOperation(
	context: SequenceOperationContext,
	input: unknown,
) {
	const parsed = parseOperationInput(
		sequenceResumeOperation.inputSchema,
		input,
	);
	try {
		return parseOperationOutput(
			sequenceResumeOperation.id,
			sequenceResumeOperation.outputSchema,
			await executeSequenceResumeOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(sequenceResumeOperation.id, error);
	}
}

export async function invokeSequenceTickOperation(
	context: SequenceOperationContext,
	input: unknown,
) {
	const parsed = parseOperationInput(sequenceTickOperation.inputSchema, input);
	try {
		return parseOperationOutput(
			sequenceTickOperation.id,
			sequenceTickOperation.outputSchema,
			await executeSequenceTickOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(sequenceTickOperation.id, error);
	}
}

export async function invokeSequenceReconcileOperation(
	context: SequenceOperationContext,
	input: unknown,
) {
	const parsed = parseOperationInput(
		sequenceReconcileOperation.inputSchema,
		input,
	);
	try {
		return parseOperationOutput(
			sequenceReconcileOperation.id,
			sequenceReconcileOperation.outputSchema,
			await executeSequenceReconcileOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(
			sequenceReconcileOperation.id,
			error,
		);
	}
}

export async function invokeSequenceStatusOperation(
	context: SequenceOperationContext,
	input: unknown,
) {
	const parsed = parseOperationInput(
		sequenceStatusOperation.inputSchema,
		input,
	);
	try {
		return parseOperationOutput(
			sequenceStatusOperation.id,
			sequenceStatusOperation.outputSchema,
			await executeSequenceStatusOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(sequenceStatusOperation.id, error);
	}
}

const bindings = [
	{
		operation: sequenceValidateOperation,
		invoke: invokeSequenceValidateOperation,
	},
	{ operation: sequenceCreateOperation, invoke: invokeSequenceCreateOperation },
	{ operation: sequenceUpdateOperation, invoke: invokeSequenceUpdateOperation },
	{ operation: sequenceListOperation, invoke: invokeSequenceListOperation },
	{ operation: sequenceGetOperation, invoke: invokeSequenceGetOperation },
	{ operation: sequenceDeleteOperation, invoke: invokeSequenceDeleteOperation },
	{ operation: sequenceEnrollOperation, invoke: invokeSequenceEnrollOperation },
	{
		operation: sequenceEnrollmentListOperation,
		invoke: invokeSequenceEnrollmentListOperation,
	},
	{
		operation: sequenceEnrollmentGetOperation,
		invoke: invokeSequenceEnrollmentGetOperation,
	},
	{ operation: sequencePauseOperation, invoke: invokeSequencePauseOperation },
	{ operation: sequenceResumeOperation, invoke: invokeSequenceResumeOperation },
	{ operation: sequenceTickOperation, invoke: invokeSequenceTickOperation },
	{
		operation: sequenceReconcileOperation,
		invoke: invokeSequenceReconcileOperation,
	},
	{ operation: sequenceStatusOperation, invoke: invokeSequenceStatusOperation },
] as const;

export const sequenceOperations = bindings.map((binding) => binding.operation);
export const sequenceOperationCatalog = defineOperationCatalog({
	id: "sequences",
	title: "Headless email sequences",
	operations: sequenceOperations,
	specMigrationExemptions: [],
});
const byMcpName = new Map(
	bindings.map((binding) => [binding.operation.mcp.name, binding] as const),
);

export function getSequenceOperationByMcpName(name: string) {
	return byMcpName.get(name)?.operation;
}

export async function invokeSequenceOperationByMcpName(
	context: SequenceOperationContext,
	name: string,
	input: unknown,
): Promise<
	| { operation: (typeof sequenceOperations)[number]; output: unknown }
	| undefined
> {
	const binding = byMcpName.get(name);
	if (!binding) {
		return undefined;
	}
	const output = await binding.invoke(context, input);
	return { operation: binding.operation, output };
}
