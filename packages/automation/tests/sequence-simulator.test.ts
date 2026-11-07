import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	assertSequenceSimulationBounds,
	readSequenceSimulationSnapshot,
	sequenceSimulationOptionsSchema,
	simulateSequenceSnapshot,
} from "../src/sequence-simulator";
import {
	invokeSequenceSimulateOperation,
	invokeSequenceOperationByMcpName,
	sequenceSimulateOperation,
} from "../src/sequence-operations";
import {
	createFileSequenceRepository,
	createSequenceDefinition,
	type SequenceDefinition,
	type SequenceEnrollment,
	type SequenceRepository,
	type SequenceStep,
} from "../src/sequences";

const at = "2026-01-01T00:00:00Z";
const id = "11111111-1111-4111-8111-111111111111";
const enrollmentId = "22222222-2222-4222-8222-222222222222";
const subscriber = {
	status: "enabled",
	lists: [{ id: 7, subscription_status: "confirmed" }],
};
const send: SequenceStep = {
	id: "send",
	type: "send",
	templateId: 3,
	consentListIds: [7],
};
const stop: SequenceStep = { id: "stop", type: "stop" };
function options(extra: Record<string, unknown> = {}) {
	return sequenceSimulationOptionsSchema.parse({ at, subscriber, ...extra });
}
function definition(steps: readonly SequenceStep[]): SequenceDefinition {
	return {
		id,
		name: "Private name",
		status: "active",
		currentRevision: 1,
		revisions: [{ revision: 1, steps, createdAt: at }],
		createdAt: at,
		updatedAt: at,
	};
}
function enrollment(extra: Partial<SequenceEnrollment> = {}): SequenceEnrollment {
	return {
		id: enrollmentId,
		sequenceId: id,
		subscriberId: 777,
		revision: 1,
		context: { plan: "private-plan" },
		status: "pending",
		retryCount: 0,
		currentStepId: "send",
		nextRunAt: at,
		lastTransitionAt: at,
		createdAt: at,
		updatedAt: at,
		...extra,
	};
}
function repository(def: SequenceDefinition, member = enrollment()) {
	const calls: string[] = [];
	const value = new Proxy(
	 {
		 kind: "file",
		 getDefinition: async () => {
			 calls.push("getDefinition");
			 return structuredClone(def);
		 },
		 getEnrollment: async () => {
			 calls.push("getEnrollment");
			 return structuredClone(member);
		 },
	 },
	 {
		 get(target, key) {
			 if (!(key in target)) throw new Error(`Unexpected mutation/capability: ${String(key)}`);
			 return Reflect.get(target, key);
		 },
	 },
 );
	return { calls, value: value as unknown as SequenceRepository };
}

describe("fixed-clock no-send sequence simulator", () => {
 test("uses actual context-only branches and stops before the first send", async () => {
  const steps: SequenceStep[] = [{ id: "branch", type: "condition", path: "plan", operator: "equals", value: { tier: "pro" }, onTrue: "send", onFalse: "stop" }, send, stop];
  const input = { steps };
		const before = structuredClone(input);
  const result = await simulateSequenceSnapshot(input, options({ context: { plan: { tier: "pro" } } }));
  expect(result.outcome).toBe("send_boundary");
  expect(result.timeline.map((row) => row.step_id)).toEqual(["branch", "send"]);
  expect(result.timeline[0]).toMatchObject({ matched: true, next_step_id: "send" });
  expect(input).toEqual(before);
  const other = await simulateSequenceSnapshot(input, options({ context: {} }));
  expect(other.outcome).toBe("completed_path");
		expect(other.timeline[0]?.matched).toBe(false);
 });
 test("exists treats null as present and rejects inherited/array-path traversal like the engine", async () => {
  const branch = { id: "branch", type: "condition", path: "value", operator: "exists", onTrue: "send", onFalse: "stop" } as const;
  expect((await simulateSequenceSnapshot({ steps: [branch, send, stop] }, options({ context: { value: null } }))).timeline[0]?.matched).toBe(true);
  const arrayBranch = { ...branch, path: "value.x" };
  expect((await simulateSequenceSnapshot({ steps: [arrayBranch, send, stop] }, options({ context: { value: [{ x: true }] } }))).timeline[0]?.matched).toBe(false);
 });
 test("relative and absolute waits produce deterministic earliest eligibility, not sends", async () => {
  const steps: SequenceStep[] = [{ id: "wait", type: "wait", durationSeconds: 60 }, { id: "until", type: "wait_until", at: "2026-01-01T00:02:00Z" }, send];
  const first = await simulateSequenceSnapshot({ steps }, options());
  expect(first).toEqual(await simulateSequenceSnapshot({ steps }, options()));
  expect(first.timeline[0]?.earliest_next_at).toBe("2026-01-01T00:01:00.000Z");
  expect(first.timeline[1]?.earliest_next_at).toBe("2026-01-01T00:02:00.000Z");
  expect(first.timeline[2]?.at).toBe("2026-01-01T00:02:00.000Z");
  expect(first.limitations.join(" ")).toContain("hypothetical earliest");
  const past = await simulateSequenceSnapshot({ steps: [{ id: "past", type: "wait_until", at: "2025-01-01T00:00:00Z" }, stop] }, options());
  expect(past.timeline[0]?.earliest_next_at).toBe("2026-01-01T00:00:00.000Z");
 });
 test("fresh snapshots explain global suppression and every required-list consent", async () => {
  for (const status of ["BLOCKLISTED", "disabled"]) {
   const result = await simulateSequenceSnapshot({ steps: [send] }, options({ subscriber: { ...subscriber, status } }));
   expect(result.outcome).toBe("snapshot_cancelled");
  }
  const unsubscribed = await simulateSequenceSnapshot({ steps: [{ ...send, consentListIds: undefined }] }, options({ subscriber: { status: "enabled", lists: [{ subscription_status: "unsubscribed" }] } }));
  expect(unsubscribed.outcome).toBe("snapshot_cancelled");
  const absent = await simulateSequenceSnapshot({ steps: [send] }, options({ subscriber: { status: "enabled", lists: [] } }));
  expect(absent.outcome).toBe("snapshot_cancelled");
  const multi = await simulateSequenceSnapshot({ steps: [{ ...send, consentListIds: [7, 8] }] }, options());
  expect(multi.outcome).toBe("snapshot_cancelled");
 });
 test("incomplete or unsupported membership evidence stays unknown for scoped and legacy sends", async () => {
  for (const lists of [
   [{ id: 7 }], [{ subscription_status: "confirmed" }], [{}],
   [{ id: 7, subscription_status: "future-status" }],
   [{ id: 7, subscription_status: "unsubscribed" }, { id: 8 }],
  ]) {
   for (const step of [send, { ...send, consentListIds: undefined }]) {
    const input = options({ subscriber: { status: "enabled", lists } });
    const before = structuredClone(input);
    const first = await simulateSequenceSnapshot({ steps: [step] }, input);
    expect(first.outcome).toBe("unknown");
    expect(first.timeline[0]?.reason).toContain("incomplete");
    expect(await simulateSequenceSnapshot({ steps: [step] }, input)).toEqual(first);
    expect(input).toEqual(before);
    expect(JSON.stringify(first)).not.toContain("future-status");
   }
  }
 });
 test("known suppression remains definitive even if unrelated membership evidence is incomplete", async () => {
  for (const snapshot of [
   { status: "disabled", lists: [{ id: 7 }] },
   { status: "blocklisted" },
   { status: "enabled", lists: [{ subscription_status: "unsubscribed" }] },
  ]) {
   expect((await simulateSequenceSnapshot({ steps: [send] }, options({ subscriber: snapshot }))).outcome).toBe("snapshot_cancelled");
  }
  expect((await simulateSequenceSnapshot({ steps: [send] }, options({ subscriber: { status: "future-status", lists: [] } }))).outcome).toBe("unknown");
 });
 test("unconfirmed membership uses only supplied single/double policy and missing policy stays unknown", async () => {
  const snapshot = { status: "enabled", lists: [{ id: 7, subscription_status: "unconfirmed" }] };
  for (const [optin, outcome] of [["single", "send_boundary"], ["double", "snapshot_cancelled"]] as const) {
   expect((await simulateSequenceSnapshot({ steps: [send] }, options({ subscriber: snapshot, list_policies: [{ id: 7, optin }] }))).outcome).toBe(outcome);
  }
  expect((await simulateSequenceSnapshot({ steps: [send] }, options({ subscriber: snapshot }))).outcome).toBe("unknown");
  expect((await simulateSequenceSnapshot({ steps: [send] }, options({ subscriber: undefined }))).outcome).toBe("unknown");
  expect((await simulateSequenceSnapshot({ steps: [send] }, options({ subscriber: { status: "enabled" } }))).outcome).toBe("unknown");
 });
 test("legacy unscoped sends preserve legacy consent policy but never assume delivery", async () => {
  const result = await simulateSequenceSnapshot({ steps: [{ ...send, consentListIds: undefined }] }, options({ subscriber: { status: "enabled", lists: [] } }));
  expect(result.outcome).toBe("send_boundary");
  expect(result.timeline[0]?.reason).toContain("no message is sent");
 });
 test("file references use pinned enrollment revision/context, not current sequence revision", async () => {
  const branch: SequenceStep = { id: "branch", type: "condition", path: "plan", operator: "equals", value: "private-plan", onTrue: "send", onFalse: "stop" };
  const def = definition([branch, send, stop]);
  const changed = { ...def, currentRevision: 2, revisions: [...def.revisions, { revision: 2, steps: [stop], createdAt: at }] };
  const { value, calls } = repository(changed, enrollment({ currentStepId: "branch" }));
  const result = await invokeSequenceSimulateOperation({ repository: value }, { id, enrollment_id: enrollmentId, at, subscriber });
  expect(calls).toEqual(["getEnrollment", "getDefinition"]);
  expect(result).toMatchObject({ source: "enrollment", revision: 1, current_revision: 2, revision_changed: true, outcome: "unknown" });
  expect(result.timeline[0]?.matched).toBe(true);
  expect(result.timeline[1]?.reason).toContain("receipt is unknown");
  const serialized = JSON.stringify(result);
  for (const sensitive of ["private-plan", "Private name", "777", enrollmentId]) expect(serialized).not.toContain(sensitive);
 });
 test("paused, terminal, leased and not-yet-due references are gated without claiming", async () => {
  for (const [def, member] of [
   [{ ...definition([send]), status: "paused" }, enrollment()],
   [definition([send]), enrollment({ status: "ambiguous" })],
   [definition([send]), enrollment({ status: "completed" })],
   [definition([send]), enrollment({ leaseExpiresAt: "2026-01-01T01:00:00Z" })],
   [definition([send]), enrollment({ nextRunAt: "2026-01-01T01:00:00Z" })],
  ] as Array<[SequenceDefinition, SequenceEnrollment]>) {
   const { value, calls } = repository(def, member);
   const result = await invokeSequenceSimulateOperation({ repository: value }, { id, enrollment_id: enrollmentId, at });
   expect(result.outcome).toBe("blocked");
			expect(calls).toEqual(["getEnrollment", "getDefinition"]);
  }
 });
 test("legacy invalid sender fails before unknown receipt/consent, matching engine order", async () => {
  const bad = { ...send, fromEmail: "bad,mailbox" };
  const result = await simulateSequenceSnapshot({ steps: [bad], enrollment: enrollment() }, options());
  expect(result.outcome).toBe("invalid_sender");
 });
 test("step and JSON budgets bound work; unsupported steps and loops are rejected", async () => {
  const result = await simulateSequenceSnapshot({ steps: [{ id: "wait", type: "wait", durationSeconds: 1 }, stop] }, options({ max_steps: 1 }));
  expect(result.outcome).toBe("limit");
		expect(result.timeline).toHaveLength(1);
  await expect(invokeSequenceSimulateOperation({}, { at, steps: [{ id: "future", type: "future_delivery" }] })).rejects.toThrow();
  await expect(invokeSequenceSimulateOperation({}, { at, steps: [{ id: "loop", type: "condition", path: "x", operator: "exists", on_true: "loop", on_false: "loop" }] })).rejects.toThrow();
  expect(() => assertSequenceSimulationBounds({ value: "x".repeat(262145) })).toThrow("256 KiB");
  let nested: unknown = {};
		for (let i = 0; i < 35; i += 1) nested = { nested };
  expect(() => assertSequenceSimulationBounds(nested)).toThrow("depth");
  await expect(simulateSequenceSnapshot({ steps: Array(501).fill(stop) }, options())).rejects.toThrow("500");
 });
 test("conflicting inputs and missing fixed clock fail before any repository read", async () => {
  const { value, calls } = repository(definition([stop]));
  for (const input of [{ id }, { at }, { at, id, steps: [{ id: "stop", type: "stop" }] }, { at, steps: [{ id: "stop", type: "stop" }], enrollment_id: enrollmentId }, { at, id, enrollment_id: enrollmentId, context: {} }]) {
   await expect(invokeSequenceSimulateOperation({ repository: value }, input)).rejects.toThrow();
  }
  expect(calls).toEqual([]);
 });
 test("Postgres references fail before initializing/reading; explicit steps ignore repositories entirely", async () => {
  const { value, calls } = repository(definition([stop]));
  const pg = { kind: "postgres", getDefinition: value.getDefinition, getEnrollment: value.getEnrollment } as const;
  await expect(readSequenceSimulationSnapshot(pg, id)).rejects.toThrow("file repositories only");
		expect(calls).toEqual([]);
  const result = await invokeSequenceSimulateOperation({ repository: new Proxy({} as SequenceRepository, { get() { throw new Error("Repository touched"); } }) }, { at, steps: [{ id: "stop", type: "stop" }] });
  expect(result.outcome).toBe("completed_path");
 });
 test("file-backed simulation leaves sequence state byte-for-byte unchanged", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sequence-simulator-"));
  try {
   const path = join(directory, "sequences.json");
			const repo = createFileSequenceRepository(path);
   const def = await repo.createDefinition(createSequenceDefinition({ name: "Fixture", steps: [stop] }, new Date(at)));
   const before = await readFile(path);
			const digest = createHash("sha256").update(before).digest("hex");
   const result = await invokeSequenceSimulateOperation({ repository: repo }, { id: def.id, at });
   expect(result.outcome).toBe("completed_path");
   expect(createHash("sha256").update(await readFile(path)).digest("hex")).toBe(digest);
  } finally { await rm(directory, { recursive: true, force: true }); }
 });
 test("MCP dispatch and CLI invoker share contracts and redact unnecessary subscriber properties", async () => {
  const input = { at, steps: [{ id: "send", type: "send", template_id: 3 }], subscriber: { status: "enabled", lists: [], email: "sensitive@example.test", attribs: { private: "secret" } } };
  const cli = await invokeSequenceSimulateOperation({}, input);
  const mcp = await invokeSequenceOperationByMcpName({}, "listmonk_sequences_simulate", input);
  expect(mcp?.output).toEqual(cli);
		expect(JSON.stringify(cli)).not.toContain("sensitive");
		expect(JSON.stringify(cli)).not.toContain("secret");
  expect(sequenceSimulateOperation.safety).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
 });
});
