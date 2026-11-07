import { afterEach, describe, expect, test } from "bun:test";
import {
	mkdtemp,
	readFile,
	readdir,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	collectOpsHealth,
	MAX_OPS_HEALTH_FILE_BYTES,
	opsHealthInputSchema,
	summarizeOpsHealthSequence,
	summarizeOpsHealthWebhooks,
} from "../src/ops-health";
import {
	invokeOpsHealthOperation,
	invokeOpsOperationByMcpName,
	opsHealthOperation,
} from "../src/ops-operations";

const at = "2026-11-07T00:00:00.000Z";
const now = new Date(at);
const id = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const input = opsHealthInputSchema.parse({ at });
const worker = (heartbeatAt = at) => ({ status: "running", heartbeatAt });
const sequence = (enrollments: unknown[] = [], workers = [worker()]) => ({
	version: 1,
	definitions: [{ id, status: "active" }],
	enrollments,
	workers,
});
const enrollment = (status = "pending", extra = {}) => ({
	sequenceId: id,
	status,
	nextRunAt: at,
	retryCount: 0,
	...extra,
});
function webhook(
 deliveries: unknown[] = [],
 endpointRuntime: unknown[] = [],
 workers = [worker()],
) {
	return {
		version: 2,
		endpoints: [{ id, enabled: true }],
		deliveries,
		endpointRuntime,
		workers,
	};
}

const delivery = (status = "pending", extra = {}) => ({
	endpointId: id,
	status,
	nextAttemptAt: at,
	...extra,
});
const dirs: string[] = [];
afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function files(sequences: unknown = sequence(), webhooks: unknown = webhook()) {
	const dir = await mkdtemp(join(tmpdir(), "ops-health-"));
	dirs.push(dir);
	const sequencePath = join(dir, "sequences.json");
	const webhookPath = join(dir, "webhooks.json");
	await writeFile(sequencePath, JSON.stringify(sequences));
	await writeFile(webhookPath, JSON.stringify(webhooks));
	return {
		dir,
		sequencePath,
		webhookPath,
		context: {
			sequenceSource: { kind: "file" as const, path: sequencePath },
			webhookSource: { kind: "file" as const, path: webhookPath },
		},
	};
}
const codes = (component: ReturnType<typeof summarizeOpsHealthSequence>) => component.findings.map(
	(finding) => finding.code,
);

describe("consolidated read-only ops health", () => {
 test("healthy requires complete scoped evidence and fresh non-future worker heartbeats", async () => {
  const { context } = await files();
  const report = await invokeOpsHealthOperation(context, { at });
  expect(report).toMatchObject({ checked_at: at, severity: "healthy", check_passed: true, complete: true, truncated: false });
  expect(report.components).toHaveLength(2);
  expect(report.components.every((component) => component.availability === "available")).toBe(true);
 });
 test("classifies ambiguous outcomes, exhausted retries and expired leases without exporting private data", () => {
  const raw = sequence([enrollment("ambiguous"), enrollment("failed", { retryCount: 24 }), enrollment("running", { leaseExpiresAt: at }), enrollment("running"), enrollment("failed")]);
  const result = summarizeOpsHealthSequence(raw, input, now);
  expect(result.severity).toBe("critical");
  expect(result.metrics).toMatchObject({ ambiguous: 1, retries_exhausted: 1, expired_leases: 1, unleased_running: 1, failed: 2 });
  expect(codes(result)).toEqual(expect.arrayContaining(["ambiguous_result", "retries_exhausted", "failed_enrollment", "expired_lease", "unleased_running"]));
 });
 test("surfaces exhausted DLQ, circuit state, expired and absent delivering leases", () => {
  const result = summarizeOpsHealthWebhooks(webhook([delivery("exhausted"), delivery("delivering", { leaseExpiresAt: at }), delivery("delivering")], [{ endpointId: id, circuitState: "open", circuitOpenUntil: "2026-11-07T00:01:00Z" }]), input, now);
  expect(result.severity).toBe("critical");
  expect(result.metrics).toMatchObject({ exhausted: 1, dead_letter: 1, circuit_open: 1, expired_leases: 1, unleased_delivering: 1 });
  expect(codes(result)).toEqual(expect.arrayContaining(["dead_letter", "circuit_open", "expired_lease", "unleased_delivering"]));
 });
 test("staleness equality is fresh, one millisecond older is stale, future timestamps are unknown", () => {
  const boundary = new Date(now.getTime() - 90000).toISOString();
  expect(summarizeOpsHealthSequence(sequence([], [worker(boundary)]), input, now).severity).toBe("healthy");
  const stale = summarizeOpsHealthWebhooks(webhook([], [], [worker(new Date(now.getTime() - 90001).toISOString())]), input, now);
  expect(stale.metrics).toMatchObject({ workers_running: 0, workers_stale: 1 });
  expect(stale.severity).toBe("unknown");
  const future = summarizeOpsHealthSequence(sequence([], [worker("2026-11-07T00:00:00.001Z")]), input, now);
  expect(future.metrics).toMatchObject({ workers_running: 0, workers_future: 1 });
  expect(codes(future)).toContain("future_heartbeat");
  expect(future.severity).toBe("unknown");
 });
 test("fresh workers cover retained restart history without false liveness alarms", () => {
 const records = [worker(), worker("2026-11-06T00:00:00Z"), { status: "failed", heartbeatAt: at }];
 const result = summarizeOpsHealthSequence(sequence([], records), input, now);
 expect(result.severity).toBe("healthy");
 expect(result.metrics).toMatchObject({ workers_running: 1, workers_stale: 1, workers_failed: 1 });
});
 test("fixed clock changes due, lease and circuit classification deterministically", () => {
  const raw = webhook([delivery("delivering", { leaseExpiresAt: "2026-11-07T00:01:00Z" })], [{ endpointId: id, circuitState: "open", circuitOpenUntil: "2026-11-07T00:01:00Z" }]);
  expect(summarizeOpsHealthWebhooks(raw, input, now).metrics).toMatchObject({ due: 0, expired_leases: 0, circuit_open: 1 });
  const later = new Date("2026-11-07T00:01:00Z");
  expect(summarizeOpsHealthWebhooks(raw, input, later).metrics).toMatchObject({ due: 1, expired_leases: 1, circuit_open: 0 });
  expect(summarizeOpsHealthWebhooks(raw, input, later)).toEqual(summarizeOpsHealthWebhooks(raw, input, later));
 });
 test("idle queues never fabricate worker liveness; stopped and failed evidence remains explicit", () => {
  expect(summarizeOpsHealthSequence(sequence([], []), input, now).severity).toBe("unknown");
  const result = summarizeOpsHealthWebhooks(webhook([], [], [{ status: "failed", heartbeatAt: at }]), input, now);
  expect(codes(result)).toContain("failed_worker");
  expect(result.metrics.workers_running).toBe(0);
 });
 test("active due candidates without a worker are critical, paused definitions are not runnable evidence", () => {
  const active = sequence([enrollment()], []);
  expect(codes(summarizeOpsHealthSequence(active, input, now))).toContain("due_without_worker");
  active.definitions[0]!.status = "paused";
  const paused = summarizeOpsHealthSequence(active, input, now);
  expect(paused.metrics).toMatchObject({ due: 1, due_active_definition: 0, paused_due: 1 });
  expect(codes(paused)).not.toContain("due_without_worker");
 });
 test("disabled, missing endpoints and open circuits are not asserted to send", () => {
  const raw = webhook([delivery(), delivery("retry", { endpointId: second })], [{ endpointId: id, circuitState: "open" }], []);
  raw.endpoints[0]!.enabled = false;
  const result = summarizeOpsHealthWebhooks(raw, input, now);
  expect(result.metrics.due_enabled_without_observed_open_circuit).toBe(0);
  expect(codes(result)).toEqual(expect.arrayContaining(["disabled_endpoint_due", "unresolved_endpoint", "circuit_open"]));
  expect(codes(result)).not.toContain("due_without_worker");
 });
 test("bounded prefix completeness prevents unseen issues from passing", () => {
  const raw = sequence([enrollment(), enrollment("ambiguous")]);
  const result = summarizeOpsHealthSequence(raw, { ...input, scan_limit: 1 }, now);
  expect(result).toMatchObject({ complete: false, truncated: true, severity: "unknown" });
  expect(result.coverage.find((entry) => entry.collection === "enrollments")).toEqual({ collection: "enrollments", scanned: 1, total: 2, truncated: true });
  expect(result.metrics.ambiguous).toBe(0);
  expect(codes(result)).toContain("scan_truncated");
 });
 test("truncated definitions/endpoints/runtime are not treated as complete joins", () => {
  const raw = sequence([enrollment("pending", { sequenceId: second })]);
		raw.definitions.push({ id: second, status: "active" });
  const result = summarizeOpsHealthSequence(raw, { ...input, scan_limit: 1 }, now);
  expect(result.findings.find((finding) => finding.code === "unresolved_definition")?.severity).toBe("unknown");
  const hooks = webhook([delivery()], [{ endpointId: second, circuitState: "closed" }, { endpointId: id, circuitState: "open" }], []);
  expect(codes(summarizeOpsHealthWebhooks(hooks, { ...input, scan_limit: 1 }, now))).not.toContain("due_without_worker");
 });
 test("unscanned worker heartbeats cannot produce a false no-worker critical finding", () => {
 const records = [worker("2026-11-06T00:00:00Z"), worker()];
 const partial = { ...input, scan_limit: 1 };
 for (const result of [summarizeOpsHealthSequence(sequence([enrollment()], records), partial, now), summarizeOpsHealthWebhooks(webhook([delivery()], [], records), partial, now)]) {
 expect(result.severity).toBe("unknown");
			expect(codes(result)).not.toContain("due_without_worker");
 }
 });
 test("partial source failure preserves healthy evidence and unknown fails the check", async () => {
  const { context, dir } = await files();
  context.webhookSource.path = join(dir, "absent", "outbox.json");
  const report = await collectOpsHealth(context, input);
  expect(report).toMatchObject({ severity: "unknown", complete: false, check_passed: false });
  expect(report.components[0]?.severity).toBe("healthy");
  expect(report.components[1]?.findings[0]?.code).toBe("missing_store");
  expect((await readdir(dir)).sort()).toEqual(["sequences.json", "webhooks.json"]);
 });
 test("missing collections, invalid versions/timestamps/status and malformed JSON are unavailable", async () => {
  for (const raw of [{ version: 1 }, { ...sequence(), version: 99 }, sequence([enrollment("future-status")]), sequence([], [worker("invalid")])]) {
   const { context } = await files(raw);
   const report = await collectOpsHealth(context, { ...input, scope: "sequences" });
   expect(report.components[0]).toMatchObject({ availability: "unavailable", severity: "unknown", complete: false });
  }
  const { context, sequencePath } = await files();
		await writeFile(sequencePath, "{not-json PRIVATE_VALUE");
  const report = await collectOpsHealth(context, input);
  expect(report.components[0]?.findings[0]?.code).toBe("invalid_json");
  expect(JSON.stringify(report)).not.toContain("PRIVATE_VALUE");
 });
 test("oversized files and symlinks are refused without reading or repairing them", async () => {
  const { context, sequencePath, dir } = await files();
  await writeFile(sequencePath, " ".repeat(MAX_OPS_HEALTH_FILE_BYTES + 1));
  let report = await collectOpsHealth(context, input);
  expect(report.components[0]).toMatchObject({ truncated: true, complete: false });
  expect(report.components[0]?.findings[0]?.code).toBe("file_limit");
  const link = join(dir, "link.json");
		await symlink(sequencePath, link);
		context.sequenceSource.path = link;
  report = await collectOpsHealth(context, input);
  expect(report.components[0]?.findings[0]?.code).toBe("read_failed");
  context.sequenceSource.path = dir;
  report = await collectOpsHealth(context, input);
  expect(report.components[0]?.findings[0]?.code).toBe("not_regular_file");
 });
 test("Postgres and conflicting targets are unknown with only offline catalog next actions", async () => {
  const report = await invokeOpsHealthOperation({ sequenceSource: { kind: "postgres" }, webhookSource: { kind: "conflict" } }, { at });
  expect(report).toMatchObject({ severity: "unknown", check_passed: false, complete: false });
  expect(report.components.map((component) => component.availability)).toEqual(["unsupported", "unavailable"]);
  expect(report.components[0]?.findings[0]?.code).toBe("postgres_not_read_only");
  for (const component of report.components) expect(component.findings[0]?.next_actions[0]?.command).toContain("operations --family");
 });
 test("critical observed issues remain visible despite another source being unknown", async () => {
  const { context } = await files(sequence([enrollment("ambiguous")]));
  const report = await collectOpsHealth({ ...context, webhookSource: { kind: "postgres" } }, input);
  expect(report).toMatchObject({ severity: "critical", complete: false, check_passed: false });
  expect(report.components[1]?.severity).toBe("unknown");
 });
 test("shared invocation is deterministic, never touches client, and leaves all source bytes/mtimes/files unchanged", async () => {
  const privateValue = "PRIVATE_EMAIL_URL_CONTEXT_SECRET_ERROR";
  const { context, dir, sequencePath, webhookPath } = await files({ ...sequence([enrollment("ambiguous", { context: { email: privateValue }, subscriberId: 123, lastError: privateValue })]), secret: privateValue }, { ...webhook([delivery("exhausted", { event: { body: privateValue }, lastError: privateValue })]), probeIdKey: privateValue });
  const before = await Promise.all([sequencePath, webhookPath].map(async (path) => ({ bytes: await readFile(path), mtime: (await stat(path)).mtimeMs })));
  const client = new Proxy({}, { get() { throw new Error("Remote client must not be touched"); } });
  const direct = await invokeOpsHealthOperation({ ...context, client: client as never }, { at });
  const invocation = await invokeOpsOperationByMcpName(context, "listmonk_ops_health", { at, send: true, apply: true });
  expect(invocation?.output).toEqual(direct);
  expect(JSON.stringify(direct)).not.toContain(privateValue);
  expect(JSON.stringify(direct)).not.toContain(id);
  expect(JSON.stringify(direct)).not.toContain(sequencePath);
  expect(JSON.stringify(direct)).not.toContain("123");
  const after = await Promise.all([sequencePath, webhookPath].map(async (path) => ({ bytes: await readFile(path), mtime: (await stat(path)).mtimeMs })));
  expect(after).toEqual(before);
  expect((await readdir(dir)).sort()).toEqual(["sequences.json", "webhooks.json"]);
  for (const component of direct.components) for (const finding of component.findings) for (const action of finding.next_actions) {
   expect(action.mode).toBe("read");
 expect(action.operation_id === undefined || action.operation_id === "ops.health").toBe(true);
 expect(action.command).not.toContain("sequences status");
 expect(action.command).not.toContain("webhooks runtime status");
			expect(action.command).not.toMatch(/retry|replay|reconcile|reset|worker|test|tick|dispatch/);
  }
 });
 test("scope and fixed/injected clocks are explicit; invalid bounds cannot reach execution", async () => {
  const { context } = await files();
  const result = await invokeOpsHealthOperation({ ...context, webhookSource: { kind: "postgres" }, now: () => now }, { scope: "sequences" });
  expect(result.components).toHaveLength(1);
		expect(result.check_passed).toBe(true);
		expect(result.checked_at).toBe(at);
  for (const invalid of [{ scan_limit: 0 }, { scan_limit: 10001 }, { worker_stale_ms: 999 }, { at: "yesterday" }, { scope: "smtp" }]) expect(opsHealthInputSchema.safeParse(invalid).success).toBe(false);
  expect(opsHealthOperation.safety).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
 });
});
