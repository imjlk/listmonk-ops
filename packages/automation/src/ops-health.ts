import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { z } from "zod";
import {
	buildSequenceRuntimeHealth,
	getSequenceStorePath,
	SEQUENCE_STORE_VERSION,
} from "./sequences";
import {
	getOutboundWebhookStorePath,
	OUTBOUND_WEBHOOK_STORE_VERSION,
	summarizeOutboundWebhookRuntimeHealth,
} from "./outbound-webhooks";
import { SEQUENCE_RETRY_MAX_ATTEMPTS } from "./sequence-engine";

export const MAX_OPS_HEALTH_FILE_BYTES = 4 * 1024 * 1024;
export const opsHealthInputSchema = z.object({
	scope: z.enum(["all", "sequences", "webhooks"]).default("all"),
	at: z.iso.datetime({ offset: true }).optional(),
	worker_stale_ms: z.number().int().min(1000).max(86400000).default(90000),
	scan_limit: z.number().int().min(1).max(10000).default(1000),
});
const severitySchema = z.enum(["healthy", "warning", "unknown", "critical"]);
const findingSchema = z.object({
	code: z.string(),
	severity: severitySchema,
	count: z.number().int().nonnegative(),
	reason: z.string(),
	next_actions: z.array(z.object({ operation_id: z.string().optional(), command: z.string(), mode: z.literal("read") })).max(
		2,
	),
});
const componentSchema = z.object({
	component: z.enum(["sequences", "webhooks"]),
	backend: z.enum(["file", "postgres", "unknown"]),
	availability: z.enum(["available", "unavailable", "unsupported"]),
	severity: severitySchema,
	complete: z.boolean(),
	truncated: z.boolean(),
	coverage: z.array(z.object({ collection: z.string(), scanned: z.number().int().nonnegative(), total: z.number().int().nonnegative(), truncated: z.boolean() })).max(
		4,
	),
	metrics: z.record(z.string(), z.number().int().nonnegative()),
	findings: z.array(findingSchema).max(32),
});
export const opsHealthOutputSchema = z.object({
	checked_at: z.string(),
	scope: z.enum(["all", "sequences", "webhooks"]),
	severity: severitySchema,
	check_passed: z.boolean(),
	complete: z.boolean(),
	truncated: z.boolean(),
	components: z.array(componentSchema).min(1).max(2),
	limitations: z.array(z.string()),
});
export type OpsHealthInput = z.output<typeof opsHealthInputSchema>;
export type OpsHealthComponent = z.output<typeof componentSchema>;
export type OpsHealthReport = z.output<typeof opsHealthOutputSchema>;
export type OpsHealthSource = { kind: "file"; path: string } | { kind: "postgres" } | { kind: "conflict" };
export interface OpsHealthContext {
	sequenceSource?: OpsHealthSource;
	webhookSource?: OpsHealthSource;
	now?: () => Date;
}
const iso = z.iso.datetime({ offset: true });
const workerSchema = z.object({
	status: z.enum(["running", "stopped", "failed"]),
	heartbeatAt: iso,
});
const sequenceProjectionSchema = z.object({
	version: z.literal(SEQUENCE_STORE_VERSION),
	definitions: z.array(
		z.object({ id: z.uuid(), status: z.enum(["active", "paused"]) }),
	),
	enrollments: z.array(
		z.object({
			sequenceId: z.uuid(),
			status: z.enum([
				"pending",
				"running",
				"waiting",
				"paused",
				"completed",
				"failed",
				"ambiguous",
				"cancelled",
			]),
			nextRunAt: iso,
			leaseExpiresAt: iso.optional(),
			retryCount: z.number().int().nonnegative(),
		}),
	),
	workers: z.array(workerSchema),
});
const webhookProjectionSchema = z.object({
	version: z.literal(OUTBOUND_WEBHOOK_STORE_VERSION),
	endpoints: z.array(z.object({ id: z.uuid(), enabled: z.boolean() })),
	deliveries: z.array(
		z.object({
			endpointId: z.uuid(),
			status: z.enum([
				"pending",
				"delivering",
				"retry",
				"succeeded",
				"exhausted",
			]),
			nextAttemptAt: iso,
			lastAttemptAt: iso.optional(),
			leaseExpiresAt: iso.optional(),
		}),
	),
	endpointRuntime: z.array(
		z.object({
			endpointId: z.uuid(),
			circuitState: z.enum(["closed", "open"]),
			circuitOpenUntil: iso.optional(),
		}),
	),
	workers: z.array(workerSchema),
});
class HealthReadError extends Error {
	constructor(readonly code: string) {
		super(code);
	}
}

/** Bounded regular-file-only read: no lock, creation, recovery, repository or database initialization. */
async function readOpsHealthFile(path: string): Promise<unknown> {
	let handle: FileHandle | undefined;
	try {
		if (typeof constants.O_NOFOLLOW !== "number" || typeof constants.O_NONBLOCK !== "number") throw new HealthReadError("safe_file_read_unavailable");
		handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
		const before = await handle.stat();
		if (!before.isFile()) throw new HealthReadError("not_regular_file");
		if (before.size > MAX_OPS_HEALTH_FILE_BYTES) throw new HealthReadError("file_limit");
		const buffer = Buffer.alloc(MAX_OPS_HEALTH_FILE_BYTES + 1);
		let length = 0;
		while (length < buffer.length) {
			const { bytesRead } = await handle.read(
				buffer,
				length,
				buffer.length - length,
				null,
			);
			if (bytesRead === 0) break;
			length += bytesRead;
		}
		if (length > MAX_OPS_HEALTH_FILE_BYTES) throw new HealthReadError("file_limit");
		const after = await handle.stat();
		if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new HealthReadError("changed_during_read");
		try {
			return JSON.parse(buffer.subarray(0, length).toString("utf8"));
		} catch {
			throw new HealthReadError("invalid_json");
		}
	} catch (error) {
		if (error instanceof HealthReadError) throw error;
		throw new HealthReadError(
			(error as { code?: string }).code === "ENOENT"
				? "missing_store"
				: "read_failed",
		);
	} finally {
		await handle?.close();
	}
}

export function resolveOpsHealthSource(component: "sequences" | "webhooks", options: { path?: string; databaseUrl?: string } = {}): OpsHealthSource {
	const sequence = component === "sequences";
	const environmentPath = process.env[sequence ? "LISTMONK_OPS_SEQUENCE_STORE" : "LISTMONK_OPS_WEBHOOK_STORE"]?.trim();
	const defaultPath = () => sequence
		? getSequenceStorePath()
		: getOutboundWebhookStorePath();
	const path = options.path ?? (environmentPath ? defaultPath() : undefined);
	const database = options.databaseUrl ?? process.env[sequence ? "LISTMONK_OPS_SEQUENCE_DATABASE_URL" : "LISTMONK_OPS_WEBHOOK_DATABASE_URL"]?.trim();
	if (path && database) return { kind: "conflict" };
	if (database) return { kind: "postgres" };
	return { kind: "file", path: path ?? defaultPath() };
}

function higher(severities: readonly OpsHealthComponent["severity"][]): OpsHealthComponent["severity"] {
	const order = { healthy: 0, warning: 1, unknown: 2, critical: 3 };
	return severities.reduce(
		(current, candidate) =>
			order[candidate] > order[current] ? candidate : current,
		"healthy",
	);
}
function readAction(component: "sequences" | "webhooks") {
 // A generic legacy status command could resolve a different CLI backend than the MCP server and initialize Postgres.
	return {
		operation_id: "ops.health",
		command: `listmonk-cli ops health --scope ${component} --scan-limit 10000`,
		mode: "read" as const,
	};
}

function add(component: OpsHealthComponent, code: string, severity: OpsHealthComponent["severity"], count: number, reason: string) {
	if (count === 0) return;
	component.findings.push({
		code,
		severity,
		count,
		reason,
		next_actions: [
			readAction(component.component),
			{
				command: `listmonk-cli operations --family ${component.component}`,
				mode: "read",
			},
		],
	});
}
const unavailableReasons: Record<string, string> = {
 postgres_not_read_only: "Postgres status paths initialize schema; health collection did not construct or query a repository",
 configuration_conflict: "Both file and Postgres targets are configured; select exactly one backend before inspection",
 configuration_failed: "Store configuration could not be resolved safely; no backend was queried",
 missing_store: "Configured store does not exist; no empty healthy state was invented or created",
 file_limit: "Store exceeds the 4 MiB safe-read limit; no records were inspected",
 invalid_json: "Store JSON is malformed; no repair was attempted",
 invalid_metadata: "Selected status metadata is missing, invalid or duplicated, or the store schema version is unsupported",
 read_failed: "Store could not be opened safely; check permissions and symlinks without modifying the store",
 not_regular_file: "Configured source is not a regular file; special files are not read",
 changed_during_read: "Store changed during the bounded read; inspect again rather than treating mixed evidence as healthy",
 safe_file_read_unavailable: "This platform lacks the required no-follow/nonblocking file-read flags; liveness is unknown",
};
function unavailable(component: "sequences" | "webhooks", source: OpsHealthSource, code: string): OpsHealthComponent {
	return {
	 component,
	 backend: source.kind === "file"
		 ? "file"
		 : source.kind === "postgres"
			 ? "postgres"
			 : "unknown",
	 availability: source.kind === "postgres" ? "unsupported" : "unavailable",
	 severity: "unknown",
	 complete: false,
	 truncated: code === "file_limit",
	 coverage: [],
	 metrics: {},
	 findings: [
		 {
			 code,
			 severity: "unknown",
			 count: 1,
			 reason: unavailableReasons[code] ?? "Store evidence is unavailable; no state was changed",
			 next_actions: [
				 {
					 command: `listmonk-cli operations --family ${component}`,
					 mode: "read",
				 },
			 ],
		 },
	 ],
 };
}
function project(raw: unknown, names: string[], limit: number) {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new HealthReadError("invalid_metadata");
	const record = raw as Record<string, unknown>;
	const selected: Record<string, unknown> = { version: record.version };
	const coverage: OpsHealthComponent["coverage"] = [];
	for (const name of names) {
		const array = record[name];
		if (!Array.isArray(array)) throw new HealthReadError("invalid_metadata");
		selected[name] = array.slice(0, limit);
		coverage.push({
			collection: name,
			scanned: Math.min(array.length, limit),
			total: array.length,
			truncated: array.length > limit,
		});
	}
	return { selected, coverage };
}
function assertUnique(ids: string[]) {
	if (new Set(ids).size !== ids.length) throw new HealthReadError("invalid_metadata");
}
function base(component: "sequences" | "webhooks", coverage: OpsHealthComponent["coverage"]): OpsHealthComponent {
	const truncated = coverage.some((entry) => entry.truncated);
	return {
		component,
		backend: "file",
		availability: "available",
		severity: "healthy",
		complete: !truncated,
		truncated,
		coverage,
		metrics: {},
		findings: [],
	};
}
function workers(component: OpsHealthComponent, records: z.output<typeof workerSchema>[], now: Date, running: number, stale: number, failed: number, stopped: number) {
	const future = records.filter(
		(worker) => Date.parse(worker.heartbeatAt) > now.getTime(),
	).length;
	add(
	 component,
	 "future_heartbeat",
	 "unknown",
	 future,
	 "Future heartbeat timestamps cannot establish worker liveness; check clocks",
 );
	add(
	 component,
	 "stale_worker",
	 running > 0 ? "healthy" : "warning",
	 stale,
	 running > 0
		 ? "Stale records coexist with fresh workers and may be retained restart history; no liveness failure is inferred"
		 : "Retained running-worker records have stale heartbeats; inspect before intervention",
 );
	add(
	 component,
	 "failed_worker",
	 running > 0 ? "healthy" : "warning",
	 failed,
	 "Retained failed-worker records may describe historical failures; fresh workers, when present, establish current liveness",
 );
	if (running === 0) add(component, "liveness_unknown", "unknown", 1, "No fresh non-future running heartbeat was observed; an idle queue is not proof of liveness");
	component.metrics.workers_running = running;
	component.metrics.workers_stale = stale;
	component.metrics.workers_failed = failed;
	component.metrics.workers_stopped = stopped;
	component.metrics.workers_future = future;
}

/** Classify only a bounded, privacy-minimal projection; shared status reducers remain authoritative for status counts. */
export function summarizeOpsHealthSequence(raw: unknown, input: OpsHealthInput, now: Date): OpsHealthComponent {
	const { selected, coverage } = project(
		raw,
		["definitions", "enrollments", "workers"],
		input.scan_limit,
	);
	const data = sequenceProjectionSchema.parse(selected);
	assertUnique(data.definitions.map((definition) => definition.id));
	const component = base("sequences", coverage);
	const nowMs = now.getTime();
	const health = buildSequenceRuntimeHealth(
		"file",
		data.definitions,
		data.enrollments,
		data.workers.filter((worker) => Date.parse(worker.heartbeatAt) <= nowMs),
		{ now, workerStaleMs: input.worker_stale_ms },
	);
	const definitions = new Map(
		data.definitions.map((definition) => [definition.id, definition.status]),
	);
	const due = data.enrollments.filter(
	 (entry) => ["pending", "running", "waiting"].includes(entry.status) && Date.parse(entry.nextRunAt) <= nowMs && (!entry.leaseExpiresAt || Date.parse(entry.leaseExpiresAt) <= nowMs),
 );
	const claimable = due.filter(
		(entry) => definitions.get(entry.sequenceId) === "active",
	).length;
	const unresolved = due.filter(
		(entry) => !definitions.has(entry.sequenceId),
	).length;
	const definitionTruncated = coverage.find(
		(entry) => entry.collection === "definitions",
	)!.truncated;
	const expired = data.enrollments.filter(
	 (entry) => entry.status === "running" && entry.leaseExpiresAt !== undefined && Date.parse(entry.leaseExpiresAt) <= nowMs,
 ).length;
	const unfenced = data.enrollments.filter(
		(entry) => entry.status === "running" && entry.leaseExpiresAt === undefined,
	).length;
	const exhausted = data.enrollments.filter(
	 (entry) => entry.status === "failed" && entry.retryCount >= SEQUENCE_RETRY_MAX_ATTEMPTS,
 ).length;
	component.metrics = { due: health.enrollments.due, due_active_definition: claimable, paused_due: due.filter((entry) => definitions.get(entry.sequenceId) === "paused").length, ambiguous: health.enrollments.ambiguous, failed: health.enrollments.failed, retries_exhausted: exhausted, expired_leases: expired, unleased_running: unfenced };
	workers(
		component,
		data.workers,
		now,
		health.workers.running,
		health.workers.stale,
		health.workers.failed,
		health.workers.stopped,
	);
	add(
	 component,
	 "ambiguous_result",
	 "critical",
	 health.enrollments.ambiguous,
	 "Enrollment results are ambiguous; inspect receipts before any separately authorized recovery",
 );
	add(
	 component,
	 "retries_exhausted",
	 "critical",
	 exhausted,
	 "Failed enrollments reached the engine retry ceiling; no automatic replay is attempted",
 );
	add(
	 component,
	 "failed_enrollment",
	 "warning",
	 health.enrollments.failed - exhausted,
	 "Retained failed enrollments require inspection; failure reason and subscriber data are not exported",
 );
	add(
	 component,
	 "expired_lease",
	 "warning",
	 expired,
	 "Running enrollment leases expired; prior send outcomes may be uncertain, so inspect before recovery",
 );
	add(
	 component,
	 "unleased_running",
	 "warning",
	 unfenced,
	 "Running enrollments have no lease timestamp; no repair or execution is attempted",
 );
	add(
		component,
		"unresolved_definition",
		definitionTruncated ? "unknown" : "warning",
		unresolved,
		definitionTruncated
			? "Due enrollment definitions are outside the bounded definition sample"
			: "Due enrollments reference absent definitions and cannot be claimed",
	);
	if (claimable > 0 && health.workers.running === 0 && !coverage.find((entry) => entry.collection === "workers")!.truncated) add(component, "due_without_worker", "critical", claimable, "Due candidates reference active definitions but no fresh non-future heartbeat; execution eligibility is not established");
	return finish(component);
}

export function summarizeOpsHealthWebhooks(raw: unknown, input: OpsHealthInput, now: Date): OpsHealthComponent {
	const { selected, coverage } = project(
		raw,
		["endpoints", "deliveries", "endpointRuntime", "workers"],
		input.scan_limit,
	);
	const data = webhookProjectionSchema.parse(selected);
	assertUnique(data.endpoints.map((endpoint) => endpoint.id));
	assertUnique(data.endpointRuntime.map((runtime) => runtime.endpointId));
	const component = base("webhooks", coverage);
	const nowMs = now.getTime();
	const health = summarizeOutboundWebhookRuntimeHealth(
		"file",
		data.endpoints,
		data.deliveries,
		data.endpointRuntime,
		data.workers.filter((worker) => Date.parse(worker.heartbeatAt) <= nowMs),
		now,
		input.worker_stale_ms,
	);
	const endpoints = new Map(
		data.endpoints.map((endpoint) => [endpoint.id, endpoint.enabled]),
	);
	const open = new Set(
	 data.endpointRuntime.filter((runtime) => runtime.circuitState === "open" && (!runtime.circuitOpenUntil || Date.parse(runtime.circuitOpenUntil) > nowMs)).map(
		 (runtime) => runtime.endpointId,
	 ),
 );
	const due = data.deliveries.filter((delivery) =>
	 ["pending", "retry"].includes(delivery.status)
		 ? Date.parse(delivery.nextAttemptAt) <= nowMs
		 : delivery.status === "delivering" && (!delivery.leaseExpiresAt || Date.parse(delivery.leaseExpiresAt) <= nowMs),
 );
	const unknownEndpoint = due.filter(
		(delivery) => !endpoints.has(delivery.endpointId),
	).length;
	const claimable = due.filter(
	 (delivery) => endpoints.get(delivery.endpointId) === true && !open.has(delivery.endpointId),
 ).length;
	const expired = data.deliveries.filter(
	 (delivery) => delivery.status === "delivering" && delivery.leaseExpiresAt !== undefined && Date.parse(delivery.leaseExpiresAt) <= nowMs,
 ).length;
	const unfenced = data.deliveries.filter(
	 (delivery) => delivery.status === "delivering" && delivery.leaseExpiresAt === undefined,
 ).length;
	component.metrics = { due: health.deliveries.due, due_enabled_without_observed_open_circuit: claimable, exhausted: health.deliveries.exhausted, dead_letter: health.deliveries.deadLetter, circuit_open: health.endpoints.circuitOpen, expired_leases: expired, unleased_delivering: unfenced };
	workers(
		component,
		data.workers,
		now,
		health.workers.running,
		health.workers.stale,
		health.workers.failed,
		health.workers.stopped,
	);
	add(
	 component,
	 "disabled_endpoint_due",
	 "warning",
	 due.filter((delivery) => endpoints.get(delivery.endpointId) === false).length,
	 "Due deliveries target disabled endpoints and cannot be sent; inspect before intervention",
 );
	add(
	 component,
	 "dead_letter",
	 "critical",
	 health.deliveries.deadLetter,
	 "Deliveries are exhausted/dead-lettered; inspect the DLQ before any separately authorized replay",
 );
	add(
	 component,
	 "circuit_open",
	 "warning",
	 health.endpoints.circuitOpen,
	 "Endpoint circuits are open at the supplied clock; inspect state and cooldown without resetting them",
 );
	add(
	 component,
	 "expired_lease",
	 "warning",
	 expired,
	 "Delivering leases expired; this does not prove whether the remote endpoint received an event",
 );
	add(
	 component,
	 "unleased_delivering",
	 "warning",
	 unfenced,
	 "Delivering records lack lease timestamps; no reconciliation or retry is attempted",
 );
	const endpointTruncated = coverage.find(
		(entry) => entry.collection === "endpoints",
	)!.truncated;
	add(
		component,
		"unresolved_endpoint",
		endpointTruncated ? "unknown" : "warning",
		unknownEndpoint,
		endpointTruncated
			? "Due delivery endpoints are outside the bounded endpoint sample"
			: "Due deliveries reference absent endpoints and cannot be dispatched",
	);
 // Missing circuit rows are normal: the engine creates runtime state lazily. A truncated runtime sample is not complete evidence.
	const runtimeTruncated = coverage.find(
		(entry) => entry.collection === "endpointRuntime",
	)!.truncated;
	if (claimable > 0 && health.workers.running === 0 && !runtimeTruncated && !coverage.find((entry) => entry.collection === "workers")!.truncated) add(component, "due_without_worker", "critical", claimable, "Due candidates reference enabled endpoints without an observed open circuit, but no fresh worker heartbeat exists");
	return finish(component);
}
function finish(component: OpsHealthComponent): OpsHealthComponent {
	if (component.truncated) add(component, "scan_truncated", "unknown", 1, "Counts are lower bounds from prefixes; unscanned records may contain additional issues");
	component.severity = higher(component.findings.map((finding) => finding.severity));
	return component;
}

/** Collect components independently; unavailable/unsupported never means healthy and no source error text escapes. */
export async function collectOpsHealth(context: OpsHealthContext, input: OpsHealthInput): Promise<OpsHealthReport> {
	const now = input.at ? new Date(input.at) : (context.now?.() ?? new Date());
	if (!Number.isFinite(now.getTime())) throw new Error("Ops health requires a valid observation clock");
	const names = input.scope === "all"
		? ["sequences", "webhooks"] as const
		: [input.scope];
	const components = await Promise.all(
	 names.map(async (component) => {
		 let source: OpsHealthSource;
		 try {
			 source = (component === "sequences" ? context.sequenceSource : context.webhookSource) ?? resolveOpsHealthSource(component);
		 } catch {
			 return unavailable(
				 component,
				 { kind: "conflict" },
				 "configuration_failed",
			 );
		 }
		 if (source.kind === "postgres") return unavailable(component, source, "postgres_not_read_only");
		 if (source.kind === "conflict") return unavailable(component, source, "configuration_conflict");
		 try {
			 const raw = await readOpsHealthFile(source.path);
			 return component === "sequences"
				 ? summarizeOpsHealthSequence(raw, input, now)
				 : summarizeOpsHealthWebhooks(raw, input, now);
		 } catch (error) {
			 return unavailable(
				 component,
				 source,
				 error instanceof HealthReadError ? error.code : "invalid_metadata",
			 );
		 }
	 }),
 );
	const severity = higher(components.map((component) => component.severity));
	return {
	 checked_at: now.toISOString(),
	 scope: input.scope,
	 severity,
	 check_passed: severity === "healthy" && components.every((component) => component.complete),
	 complete: components.every((component) => component.complete),
	 truncated: components.some((component) => component.truncated),
	 components,
	 limitations: [
		 "Scope is sequence and outbound-webhook file-state evidence, not SMTP/provider/Listmonk connectivity or actual delivery confirmation.",
		 "Due counts are scheduling candidates, not proof of runnable steps, valid pinned revisions, consent or future delivery.",
		 "Each file is read independently without locks or a cross-store transaction; state may change immediately afterward. No recovery, sending, claim, schema initialization or sequence/receipt mutation occurs.",
		 "Missing, invalid, oversized and unsupported Postgres evidence is unknown. Existing Postgres status methods bootstrap schema and are deliberately not called.",
		 "Metadata projections do not validate complete payloads or revision topology; a healthy report only describes the supported status evidence.",
		 "Metadata-only projections omit subscriber identity/context, message/event bodies, endpoint URLs/secrets, worker IDs and raw error strings. Read-only adapters do not enqueue lifecycle events or audit writes.",
		 "Counts from truncated prefixes are lower bounds. Source byte caps and per-collection scan limits are explicit; normal empty queues do not prove worker liveness.",
		 "Webhook statuses do not expose a distinct ambiguous-send state; expired in-flight leases are uncertainty signals, not proof of remote delivery. Historical failed/stale records are flagged for inspection, not automatically repaired.",
		 "Suggested actions only recheck bounded health or inspect the offline operation catalog. Legacy status commands are not suggested because another CLI configuration could initialize Postgres. No retry, replay, reset, reconcile, worker start or test-send action is executed or suggested.",
	 ],
 };
}
