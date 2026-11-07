import { z } from "zod";
import { transactionalFromEmailSchema } from "@listmonk-ops/operations";
import {
	evaluateSequenceCondition,
	sequenceSubscriberCannotReceive,
} from "./sequence-engine";
import { checkSequenceListConsent } from "./sequence-consent";
import type {
	SequenceDefinition,
	SequenceEnrollment,
	SequenceRepository,
	SequenceStep,
} from "./sequences";

export const MAX_SEQUENCE_SIMULATION_STEPS = 500;
export const sequenceSimulationSubscriberSchema = z.object({
 status: z.string().max(80).optional(),
 lists: z.array(z.object({
  id: z.number().int().positive().optional(),
  subscription_status: z.string().max(80).optional(),
 })).max(1000).optional(),
});
export const sequenceSimulationOptionsSchema = z.object({
 at: z.iso.datetime({ offset: true }),
 context: z.record(z.string(), z.unknown()).optional(),
 subscriber: sequenceSimulationSubscriberSchema.optional(),
 list_policies: z.array(z.object({ id: z.number().int().positive(), optin: z.enum(["single", "double"]) })).max(100).optional(),
 max_steps: z.number().int().min(1).max(MAX_SEQUENCE_SIMULATION_STEPS).default(100),
});
export const sequenceSimulationOutputSchema = z.object({
 at: z.string(),
 source: z.enum(["steps", "sequence", "enrollment"]),
 revision: z.number().int().positive().nullable(),
 current_revision: z.number().int().positive().nullable(),
 revision_changed: z.boolean().nullable(),
 subscriber_snapshot_present: z.boolean(),
 outcome: z.enum(["send_boundary", "snapshot_cancelled", "completed_path", "unknown", "blocked", "limit", "invalid_sender"]),
 timeline: z.array(z.object({
  step_id: z.string().nullable(),
  kind: z.enum(["condition", "wait", "wait_until", "send", "stop", "gate", "complete"]),
  at: z.string(),
  earliest_next_at: z.string().optional(),
  next_step_id: z.string().optional(),
  matched: z.boolean().optional(),
  reason: z.string(),
 })).max(MAX_SEQUENCE_SIMULATION_STEPS),
 limitations: z.array(z.string()),
});
export type SequenceSimulationOptions = z.output<typeof sequenceSimulationOptionsSchema>;
export type SequenceSimulationResult = z.output<typeof sequenceSimulationOutputSchema>;

/** Bound JSON depth, work and bytes before validation or branch evaluation; never echo input data. */
export function assertSequenceSimulationBounds(value: unknown): void {
	const pending = [{ value, depth: 0 }];
	const seen = new Set<object>();
	let nodes = 0;
	while (pending.length) {
		const item = pending.pop()!;
		if (++nodes > 10000 || item.depth > 32) throw new Error("Sequence simulation JSON exceeds depth or node limits");
		if (item.value && typeof item.value === "object") {
			if (seen.has(item.value)) continue;
			seen.add(item.value);
			for (const child of Object.values(item.value)) pending.push({ value: child, depth: item.depth + 1 });
		}
	}
	let serialized: string;
	try {
		serialized = JSON.stringify(value);
	} catch {
		throw new Error("Sequence simulation requires bounded JSON input");
	}
	if (!serialized || Buffer.byteLength(serialized) > 262144) throw new Error("Sequence simulation JSON exceeds 256 KiB");
}

export interface SequenceSimulationSnapshot {
	steps: readonly SequenceStep[];
	definition?: SequenceDefinition;
	enrollment?: SequenceEnrollment;
}

/** Pure snapshot explanation, stopping at the first send. No repository/client/claim/send capability. */
export async function simulateSequenceSnapshot(snapshot: SequenceSimulationSnapshot, options: SequenceSimulationOptions): Promise<SequenceSimulationResult> {
	assertSequenceSimulationBounds({ snapshot, options });
	if (snapshot.steps.length === 0 || snapshot.steps.length > MAX_SEQUENCE_SIMULATION_STEPS) throw new Error("Sequence simulation requires 1 to 500 steps");
	const enrollment = snapshot.enrollment;
	if (enrollment && options.context !== undefined) throw new Error("Enrollment simulations use stored context; context overrides are not supported");
	const at = new Date(options.at).toISOString();
	const timeline: SequenceSimulationResult["timeline"] = [];
	const result: SequenceSimulationResult = {
  at, source: enrollment ? "enrollment" : snapshot.definition ? "sequence" : "steps",
  revision: enrollment?.revision ?? snapshot.definition?.currentRevision ?? null,
  current_revision: snapshot.definition?.currentRevision ?? null,
  revision_changed: enrollment && snapshot.definition ? enrollment.revision !== snapshot.definition.currentRevision : null,
  subscriber_snapshot_present: options.subscriber !== undefined,
  outcome: "unknown", timeline,
  limitations: [
   "No messages, claims, enrollments, receipt/sequence-store writes or live subscriber/list lookups occur; normal adapter audit logging may still occur.",
   "Timeline timestamps are hypothetical earliest eligibility using a frozen context and supplied subscriber/list-policy snapshots, not actual worker or delivery times.",
   "Conditions evaluate enrollment context only, not subscriber fields or send-step data. Values, subscriber identity and message contents are never returned.",
   "Stops at the first send: provider acceptance, rendering, quota, retries, receipts and future subscriber changes are not predicted.",
   "Existing enrollment send receipts are not inspected: accepted/pending/unknown claims can override fresh-send consent checks, so that boundary is unknown.",
  ],
 };
	const finish = (outcome: SequenceSimulationResult["outcome"], reason: string) => {
		result.outcome = outcome;
		timeline.push({ step_id: null, kind: "gate", at, reason });
		return result;
	};
	if (snapshot.definition?.status === "paused") return finish("blocked", "Sequence definition is paused; the worker does not claim it");
	if (enrollment) {
		if (!["pending", "running", "waiting"].includes(enrollment.status)) return finish("blocked", `Enrollment status ${enrollment.status} is not claimable`);
		if (enrollment.leaseExpiresAt && Date.parse(enrollment.leaseExpiresAt) > Date.parse(at)) return finish("blocked", "Enrollment has an unexpired lease; no execution is simulated");
		if (Date.parse(enrollment.nextRunAt) > Date.parse(at)) {
			result.outcome = "blocked";
			timeline.push({
				step_id: enrollment.currentStepId,
				kind: "gate",
				at,
				earliest_next_at: enrollment.nextRunAt,
				reason: "Enrollment is not due at the supplied clock",
			});
			return result;
		}
	}
	const context = enrollment?.context ?? options.context ?? {};
	let index = enrollment
		? snapshot.steps.findIndex((step) => step.id === enrollment.currentStepId)
		: 0;
	if (index < 0) throw new Error("Enrollment step is missing from its pinned revision");
	let clock = Date.parse(at);
	const policies = options.list_policies ?? [];
	if (new Set(policies.map((policy) => policy.id)).size !== policies.length) throw new Error("List policy snapshot IDs must be unique");
	for (let visited = 0; visited < options.max_steps; visited += 1) {
		const step = snapshot.steps[index];
		if (!step) {
			result.outcome = "completed_path";
			return result;
		}
		const row: SequenceSimulationResult["timeline"][number] = {
			step_id: step.id,
			kind: step.type,
			at: new Date(clock).toISOString(),
			reason: "",
		};
		timeline.push(row);
		switch (step.type) {
			case "condition": {
				const matched = evaluateSequenceCondition(step, context);
				const target = matched ? step.onTrue : step.onFalse;
				const targetIndex = snapshot.steps.findIndex(
					(candidate) => candidate.id === target,
				);
				if (targetIndex <= index) throw new Error("Condition must target a later existing step");
				row.matched = matched;
				row.next_step_id = target;
				row.reason = `Context condition ${step.operator} ${matched ? "matched" : "did not match"}; selected ${target}`;
				index = targetIndex;
				break;
			}
			case "wait":
			case "wait_until": {
				if (!snapshot.steps[index + 1]) {
					row.reason = "No following step; runtime completes without waiting";
					result.outcome = "completed_path";
					return result;
				}
				clock = step.type === "wait" ? clock + step.durationSeconds * 1000 : Math.max(clock, Date.parse(step.at));
				if (!Number.isFinite(clock) || !Number.isFinite(new Date(clock).getTime())) throw new Error("Simulation timeline exceeds supported time range");
				row.earliest_next_at = new Date(clock).toISOString();
				row.next_step_id = snapshot.steps[index + 1]!.id;
				row.reason = step.type === "wait" ? "Relative wait starts when this step executes, not at enrollment creation" : "Absolute wait uses the later of the step timestamp and simulated execution clock";
				index += 1;
				break;
			}
			case "stop":
				row.reason = "Stop completes the hypothetical path";
				result.outcome = "completed_path";
				return result;
			case "send": {
				if (!transactionalFromEmailSchema.optional().safeParse(
					step.fromEmail,
				).success) {
					row.reason = "Stored From mailbox is invalid; engine fails before subscriber lookup";
					result.outcome = "invalid_sender";
					return result;
				}
				if (enrollment) {
					row.reason = "Existing send receipt is unknown; cannot infer replay, reconciliation, cancellation or dispatch";
					result.outcome = "unknown";
					return result;
				}
				const subscriber = options.subscriber;
				if (!subscriber || subscriber.status === undefined || subscriber.lists === undefined) {
					row.reason = "Subscriber status or list snapshot is missing; fresh-send eligibility is unknown";
					result.outcome = "unknown";
					return result;
				}
				let reason = sequenceSubscriberCannotReceive(subscriber);
				try {
					reason ??= await checkSequenceListConsent({ list: { getById: async ({ path }) => {
      const policy = policies.find((entry) => entry.id === path.list_id);
      if (!policy) throw new Error("List policy snapshot is unavailable");
      return { data: policy };
     } } }, subscriber, step.consentListIds);
				} catch {
					row.reason = "Required consent policy cannot be verified from the supplied snapshots";
					result.outcome = "unknown";
					return result;
				}
				row.reason = reason ? `Fresh-send snapshot policy would cancel: ${reason}` : "Fresh-send snapshot policy permits reaching the send boundary; no message is sent or assumed successful";
				result.outcome = reason ? "snapshot_cancelled" : "send_boundary";
				return result;
			}
			default:
				throw new Error("Unsupported sequence step type");
		}
	}
	result.outcome = index >= snapshot.steps.length ? "completed_path" : "limit";
	return result;
}

/** Only file repository reads are supported: Postgres read methods bootstrap schema and are not read-only. */
export async function readSequenceSimulationSnapshot(repository: Pick<SequenceRepository, "kind" | "getDefinition" | "getEnrollment">, id: string, enrollmentId?: string): Promise<SequenceSimulationSnapshot> {
	if (repository.kind !== "file") throw new Error("Reference simulation supports file repositories only; use an explicit steps snapshot for offline Postgres simulation");
	try {
		const enrollment = enrollmentId
			? await repository.getEnrollment(enrollmentId)
			: undefined;
		if (enrollment && enrollment.sequenceId !== id) throw new Error("Sequence simulation enrollment identity mismatch");
		const definition = await repository.getDefinition(id);
		if (definition.id !== id) throw new Error("Sequence simulation definition identity mismatch");
		const revision = definition.revisions.find(
		(item) => item.revision === (enrollment?.revision ?? definition.currentRevision),
	);
		if (!revision) throw new Error("Sequence simulation pinned revision is missing");
  // Return only the selected revision; do not copy unrelated history into the bounded simulation.
		return {
			steps: revision.steps,
			definition: { ...definition, revisions: [] },
			enrollment,
		};
	} catch {
		throw new Error(
		"Unable to read matching sequence simulation snapshots; verify IDs and revision history",
	);
	}
}
