import {
	createFileBackedTransactionalIdempotencyStore,
	hashTransactionalPayload,
} from "@listmonk-ops/common";
import {
	getSequenceRepositoryFromEnvironment,
	invokeSequenceCreateOperation,
	invokeSequenceDeleteOperation,
	invokeSequenceEnrollOperation,
	invokeSequenceGetOperation,
	invokeSequenceListOperation,
	invokeSequencePauseOperation,
	invokeSequenceReconcileOperation,
	invokeSequenceResumeOperation,
	invokeSequenceStatusOperation,
	invokeSequenceTickOperation,
	invokeSequenceUpdateOperation,
	invokeSequenceValidateOperation,
	runSequenceWorker,
	type SequenceOperationContext,
} from "@listmonk-ops/automation";
import { z } from "zod";
import {
	defineCommand,
	defineGroup,
	type HandlerArgs,
	option,
} from "../lib/command";
import { parseJson } from "../lib/command-utils";
import { resolveListmonkSession } from "../lib/listmonk";
import { getOutput } from "../lib/output";

type SequenceStepInput = {
	id: string;
	type: string;
	[key: string]: unknown;
};

function parseSteps(value: string): SequenceStepInput[] {
	const parsed = parseJson<unknown>(value, "steps");
	if (!Array.isArray(parsed)) {
		throw new TypeError("--steps must contain a JSON array");
	}
	return parsed as SequenceStepInput[];
}

function parseContext(value: string | undefined): Record<string, unknown> {
	if (!value) {
		return {};
	}
	const parsed = parseJson<unknown>(value, "context");
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		Array.isArray(parsed)
	) {
		throw new TypeError("--context must contain a JSON object");
	}
	return parsed as Record<string, unknown>;
}

async function executionContext(
	args: Omit<HandlerArgs<Record<string, unknown>>, "flags">,
): Promise<SequenceOperationContext> {
	const session = await resolveListmonkSession(args, { requireAuth: true });
	if (!session.client) {
		throw new Error("Listmonk client is not available");
	}
	return {
		repository: getSequenceRepositoryFromEnvironment(),
		client: session.client,
		idempotencyStore: createFileBackedTransactionalIdempotencyStore(),
		hashPayload: hashTransactionalPayload,
		target: { baseUrl: session.baseUrl, username: session.username },
	};
}

const validateCommand = defineCommand({
	name: "validate",
	operationId: "sequences.validate",
	description: "Validate typed sequence steps without saving them",
	options: {
		steps: option(z.string().trim().min(1), {
			description: "JSON array of sequence steps",
		}),
	},
	handler: async ({ flags }) => {
		getOutput().json(
			await invokeSequenceValidateOperation(
				{},
				{ steps: parseSteps(flags.steps) },
			),
		);
	},
});

const createCommand = defineCommand({
	name: "create",
	operationId: "sequences.create",
	description: "Create an active sequence and immutable first revision",
	options: {
		name: option(z.string().trim().min(1), { description: "Sequence name" }),
		description: option(z.string().trim().optional(), {
			description: "Sequence description",
		}),
		steps: option(z.string().trim().min(1), {
			description: "JSON array of sequence steps",
		}),
	},
	handler: async ({ flags }) => {
		getOutput().json(
			await invokeSequenceCreateOperation(
				{},
				{
					name: flags.name,
					description: flags.description,
					steps: parseSteps(flags.steps),
				},
			),
		);
	},
});

const updateCommand = defineCommand({
	name: "update",
	operationId: "sequences.update",
	description: "Append an immutable revision to a sequence",
	options: {
		id: option(z.uuid(), { description: "Sequence ID" }),
		name: option(z.string().trim().min(1).optional(), {
			description: "Updated sequence name",
		}),
		description: option(z.string().trim().optional(), {
			description: "Updated sequence description",
		}),
		steps: option(z.string().trim().min(1), {
			description: "JSON array of sequence steps",
		}),
	},
	handler: async ({ flags }) => {
		getOutput().json(
			await invokeSequenceUpdateOperation(
				{},
				{
					id: flags.id,
					name: flags.name,
					description: flags.description,
					steps: parseSteps(flags.steps),
				},
			),
		);
	},
});

const listCommand = defineCommand({
	name: "list",
	operationId: "sequences.list",
	description: "List durable sequence definitions",
	options: {
		status: option(z.enum(["active", "paused"]).optional(), {
			description: "Filter by sequence status",
		}),
	},
	handler: async ({ flags }) => {
		getOutput().json(await invokeSequenceListOperation({}, flags));
	},
});

const getCommand = defineCommand({
	name: "get",
	operationId: "sequences.get",
	description: "Get one sequence and its revision history",
	options: { id: option(z.uuid(), { description: "Sequence ID" }) },
	handler: async ({ flags }) => {
		getOutput().json(await invokeSequenceGetOperation({}, { id: flags.id }));
	},
});

const deleteCommand = defineCommand({
	name: "delete",
	operationId: "sequences.delete",
	description: "Delete a sequence with no active enrollments",
	options: { id: option(z.uuid(), { description: "Sequence ID" }) },
	handler: async ({ flags }) => {
		getOutput().json(await invokeSequenceDeleteOperation({}, { id: flags.id }));
	},
});

const enrollCommand = defineCommand({
	name: "enroll",
	operationId: "sequences.enroll",
	description: "Enroll one subscriber into the current sequence revision",
	options: {
		id: option(z.uuid(), { description: "Sequence ID" }),
		"subscriber-id": option(z.coerce.number().int().positive(), {
			description: "Listmonk subscriber ID",
		}),
		context: option(z.string().optional(), {
			description: "JSON object merged into send template data",
		}),
		"start-at": option(z.iso.datetime({ offset: true }).optional(), {
			description: "Optional first-step activation timestamp",
		}),
	},
	handler: async ({ flags }) => {
		getOutput().json(
			await invokeSequenceEnrollOperation(
				{},
				{
					id: flags.id,
					subscriber_id: flags["subscriber-id"],
					context: parseContext(flags.context),
					start_at: flags["start-at"],
				},
			),
		);
	},
});

const pauseCommand = defineCommand({
	name: "pause",
	operationId: "sequences.pause",
	description: "Pause sequence enrollment execution",
	options: { id: option(z.uuid(), { description: "Sequence ID" }) },
	handler: async ({ flags }) => {
		getOutput().json(await invokeSequencePauseOperation({}, { id: flags.id }));
	},
});

const resumeCommand = defineCommand({
	name: "resume",
	operationId: "sequences.resume",
	description: "Resume sequence enrollment execution",
	options: { id: option(z.uuid(), { description: "Sequence ID" }) },
	handler: async ({ flags }) => {
		getOutput().json(await invokeSequenceResumeOperation({}, { id: flags.id }));
	},
});

const tickCommand = defineCommand({
	name: "tick",
	operationId: "sequences.tick",
	description: "Execute one step for a bounded due-enrollment batch",
	options: {
		limit: option(z.coerce.number().int().min(1).max(100).default(25), {
			description: "Maximum enrollments to claim",
		}),
		"lease-ms": option(
			z.coerce.number().int().min(1_000).max(900_000).default(90_000),
			{ description: "Enrollment claim lease duration" },
		),
	},
	handler: async ({ flags, ...args }) => {
		getOutput().json(
			await invokeSequenceTickOperation(
				await executionContext(args),
				{ limit: flags.limit, lease_ms: flags["lease-ms"] },
			),
		);
	},
});

const reconcileCommand = defineCommand({
	name: "reconcile",
	operationId: "sequences.reconcile",
	description: "Recover expired leases or resolve one ambiguous send",
	options: {
		"enrollment-id": option(z.uuid().optional(), {
			description: "Ambiguous enrollment ID",
		}),
		resolution: option(z.enum(["sent", "not_sent"]).optional(), {
			description: "Operator-reviewed ambiguous delivery outcome",
		}),
		limit: option(z.coerce.number().int().min(1).max(1_000).default(100), {
			description: "Maximum expired leases to inspect",
		}),
		"dry-run": option(z.coerce.boolean().default(true), {
			description: "Preview expired lease recovery",
		}),
	},
	handler: async ({ flags, ...args }) => {
		const needsClient = flags["enrollment-id"] !== undefined;
		getOutput().json(
			await invokeSequenceReconcileOperation(
				needsClient ? await executionContext(args) : {},
				{
					enrollment_id: flags["enrollment-id"],
					resolution: flags.resolution,
					limit: flags.limit,
					dry_run: flags["dry-run"],
				},
			),
		);
	},
});

const statusCommand = defineCommand({
	name: "status",
	operationId: "sequences.status",
	description: "Inspect sequence runtime and worker health",
	options: {
		"worker-stale-ms": option(
			z.coerce.number().int().min(1_000).max(86_400_000).default(90_000),
			{ description: "Heartbeat age considered stale" },
		),
	},
	handler: async ({ flags }) => {
		getOutput().json(
			await invokeSequenceStatusOperation(
				{},
				{ worker_stale_ms: flags["worker-stale-ms"] },
			),
		);
	},
});

const workerCommand = defineCommand({
	name: "worker",
	description: "Run the long-lived durable sequence worker",
	options: {
		"interval-ms": option(
			z.coerce.number().int().min(250).max(90_000).default(5_000),
			{ description: "Delay between worker ticks" },
		),
		limit: option(z.coerce.number().int().min(1).max(100).default(25), {
			description: "Maximum enrollments per tick",
		}),
		"lease-ms": option(
			z.coerce.number().int().min(1_000).max(900_000).default(90_000),
			{ description: "Enrollment claim lease duration" },
		),
	},
	handler: async ({ flags, ...args }) => {
		if (flags.confirm !== true) {
			throw new Error(
				"The sequence worker may send email; rerun with --confirm",
			);
		}
		const controller = new AbortController();
		const stop = () => controller.abort();
		process.once("SIGINT", stop);
		process.once("SIGTERM", stop);
		try {
			const context = await executionContext(args);
			if (
				!context.repository ||
				!context.client ||
				!context.idempotencyStore ||
				!context.hashPayload
			) {
				throw new Error("Sequence worker execution context is incomplete");
			}
			getOutput().info(
				"Sequence worker started; press Ctrl+C for graceful shutdown",
			);
			await runSequenceWorker(
				{
					repository: context.repository,
					client: context.client,
					idempotencyStore: context.idempotencyStore,
					hashPayload: context.hashPayload,
					target: context.target,
				},
				{
					signal: controller.signal,
					intervalMs: flags["interval-ms"],
					limit: flags.limit,
					leaseMs: flags["lease-ms"],
					onTick: (tick) =>
						getOutput().info(
							`Sequence tick: ${tick.claimed} claimed, ${tick.completed} completed, ${tick.failed} failed, ${tick.ambiguous} ambiguous`,
						),
					onError: (error) =>
						getOutput().warning(
							`Sequence tick failed: ${error instanceof Error ? error.message : String(error)}`,
						),
				},
			);
		} finally {
			process.off("SIGINT", stop);
			process.off("SIGTERM", stop);
		}
	},
});

export default defineGroup({
	name: "sequences",
	description: "Headless typed email sequence operations",
	commands: [
		validateCommand,
		createCommand,
		updateCommand,
		listCommand,
		getCommand,
		deleteCommand,
		enrollCommand,
		pauseCommand,
		resumeCommand,
		tickCommand,
		reconcileCommand,
		statusCommand,
		workerCommand,
	],
});
