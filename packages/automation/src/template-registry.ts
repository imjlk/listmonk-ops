import { createHash } from "node:crypto";

import {
	commitJsonFileStoreUpdate,
	readJsonFileStore,
	type JsonFileStore,
	updateJsonFileStore,
} from "@listmonk-ops/common";
import type { ListmonkClient, Template } from "@listmonk-ops/openapi";

import { getTemplateById, unwrapResponseData } from "./api";
import {
	extractResults,
	getOpsStorePaths,
	isRecord,
	toPositiveInt,
} from "./core";

const TEMPLATE_REGISTRY_LOCK_TIMEOUT_MS = 120_000;

export interface TemplateVersionSnapshot {
	id: number;
	name: string;
	type: string;
	subject: string;
	body: string;
	bodySource?: string;
}

export interface TemplateRegistryVersion {
	versionId: string;
	capturedAt: string;
	/** Global order reserved immediately before the remote template read. */
	captureOrder?: number;
	hash: string;
	note?: string;
	snapshot: TemplateVersionSnapshot;
}

export interface TemplateRegistryTemplateRecord {
	templateId: number;
	templateName: string;
	/**
	 * The stored version whose content is live in Listmonk, as far as the
	 * registry last observed: a sync points it at the capture of the live
	 * content, and a promotion or rollback at the version it wrote. An
	 * unpinned rollback re-verifies it against the live template.
	 */
	activeVersionId?: string;
	/**
	 * Monotonic counter of registry-managed template writes. It advances
	 * even when a write restores the same active version, so a pinned retry
	 * can tell an untouched registry from one that went A → X → A.
	 */
	headRevision?: number;
	versions: TemplateRegistryVersion[];
}

export interface TemplateRegistryStore {
	version: 1;
	/** Monotonic order assigned to each template read across concurrent clients. */
	captureSequence?: number;
	templates: Record<string, TemplateRegistryTemplateRecord>;
}

export interface TemplateRegistrySyncOptions {
	templateIds?: number[];
	note?: string;
	onCaptureError?: (
		failure: Readonly<{ templateId: number; error: unknown }>,
	) => void | Promise<void>;
}

export interface TemplateRegistrySyncResult {
	storePath: string;
	capturedAt: string;
	createdVersions: number;
	unchangedTemplates: number;
	errors: string[];
	templates: Array<{
		templateId: number;
		templateName: string;
		versionId?: string;
		changed: boolean;
		hash: string;
	}>;
}

export interface TemplatePromoteResult {
	templateId: number;
	templateName: string;
	versionId: string;
	activeVersionId: string;
	/** Registry head revision after this promotion; echo it to pin a later rollback retry. */
	headRevision: number;
	promotedAt: string;
	/** False when the target version already matched the remote template (a no-op that issues no write). */
	promoted: boolean;
}

export interface TemplateRollbackResult {
	templateId: number;
	templateName: string;
	versionId: string;
	activeVersionId: string;
	/** Registry head revision after this rollback; echo it to pin a retry. */
	headRevision: number;
	promotedAt: string;
	/** False when the requested rollback was already applied. */
	rolledBack: boolean;
}

export class TemplateRegistryWriteTransactionError extends Error {
	constructor(message: string, cause: unknown) {
		super(message, { cause });
		this.name = "TemplateRegistryWriteTransactionError";
	}
}

/**
 * The live Listmonk template changed outside the registry since the last
 * sync: its content matches neither the active version nor the latest
 * capture, so the registry cannot tell which stored version is live. An
 * unpinned rollback fails closed with this error instead of guessing a
 * target.
 */
export class TemplateRegistryDriftError extends Error {
	readonly templateId: number;
	readonly liveHash: string;
	readonly activeVersionId?: string;
	/** Older stored versions whose content equals the live template. */
	readonly matchingVersionIds: readonly string[];

	constructor(
		details: Readonly<{
			templateId: number;
			liveHash: string;
			activeVersionId?: string;
			matchingVersionIds: readonly string[];
		}>,
	) {
		const matches = details.matchingVersionIds;
		const observed =
			matches.length > 0
				? `matches stored version${matches.length > 1 ? "s" : ""} ${matches.join(", ")} but neither the active version ${details.activeVersionId ?? "(none)"} nor the latest capture`
				: "matches no stored registry version";
		super(
			`Template ${details.templateId} live content (hash ${details.liveHash.slice(0, 10)}) ${observed}; it changed outside the registry since the last sync. Run registry-sync to record the live content before rolling back, or pin to_version_id to the version preceding the active one to overwrite it explicitly.`,
		);
		this.name = "TemplateRegistryDriftError";
		this.templateId = details.templateId;
		this.liveHash = details.liveHash;
		this.activeVersionId = details.activeVersionId;
		this.matchingVersionIds = details.matchingVersionIds;
	}
}

function compareTemplateVersions(
	left: TemplateRegistryVersion,
	right: TemplateRegistryVersion,
): number {
	if (left.captureOrder !== undefined && right.captureOrder !== undefined) {
		return (
			left.captureOrder - right.captureOrder ||
			left.capturedAt.localeCompare(right.capturedAt) ||
			left.versionId.localeCompare(right.versionId)
		);
	}
	return (
		left.capturedAt.localeCompare(right.capturedAt) ||
		(left.captureOrder ?? 0) - (right.captureOrder ?? 0) ||
		left.versionId.localeCompare(right.versionId)
	);
}

function migrateLegacyTemplateCaptureOrders(
	store: TemplateRegistryStore,
): void {
	const records = Object.values(store.templates);
	const legacyVersions = records
		.flatMap((record) => record.versions)
		.filter((version) => version.captureOrder === undefined)
		.sort(
			(left, right) =>
				left.capturedAt.localeCompare(right.capturedAt) ||
				left.versionId.localeCompare(right.versionId),
		);
	if (legacyVersions.length === 0) {
		return;
	}

	// Keep known modern observations in their monotonic order. Legacy entries
	// have only wall-clock timestamps, so place them relative to that sequence
	// by timestamp once, then persist a single global capture order.
	const ordered = records
		.flatMap((record) => record.versions)
		.filter((version) => version.captureOrder !== undefined)
		.sort(
			(left, right) =>
				(left.captureOrder ?? 0) - (right.captureOrder ?? 0) ||
				left.capturedAt.localeCompare(right.capturedAt) ||
				left.versionId.localeCompare(right.versionId),
		);
	for (const version of legacyVersions) {
		const nextVersionIndex = ordered.findIndex(
			(candidate) =>
				candidate.capturedAt.localeCompare(version.capturedAt) > 0,
		);
		ordered.splice(
			nextVersionIndex === -1 ? ordered.length : nextVersionIndex,
			0,
			version,
		);
	}
	for (const [index, version] of ordered.entries()) {
		version.captureOrder = index + 1;
	}
	for (const record of records) {
		record.versions.sort(compareTemplateVersions);
	}
}

function getTemplateRegistryCaptureSequenceHighWater(
	store: TemplateRegistryStore,
): number {
	let highWater = store.captureSequence ?? 0;
	let hasLegacyVersion = false;
	let versionCount = 0;
	for (const record of Object.values(store.templates)) {
		versionCount += record.versions.length;
		for (const version of record.versions) {
			if (version.captureOrder !== undefined) {
				highWater = Math.max(highWater, version.captureOrder);
			} else {
				hasLegacyVersion = true;
			}
		}
	}
	if (hasLegacyVersion) {
		highWater = Math.max(highWater, versionCount);
	}
	return highWater;
}

function isTemplateVersionSnapshot(
	value: unknown,
): value is TemplateVersionSnapshot {
	return (
		isRecord(value) &&
		typeof value.id === "number" &&
		Number.isInteger(value.id) &&
		value.id > 0 &&
		typeof value.name === "string" &&
		typeof value.type === "string" &&
		typeof value.subject === "string" &&
		typeof value.body === "string" &&
		(value.bodySource === undefined || typeof value.bodySource === "string")
	);
}

function isTemplateRegistryVersion(
	value: unknown,
): value is TemplateRegistryVersion {
	return (
		isRecord(value) &&
		typeof value.versionId === "string" &&
		typeof value.capturedAt === "string" &&
		!Number.isNaN(new Date(value.capturedAt).getTime()) &&
		(value.captureOrder === undefined ||
			(typeof value.captureOrder === "number" &&
				Number.isSafeInteger(value.captureOrder) &&
				value.captureOrder > 0)) &&
		typeof value.hash === "string" &&
		(value.note === undefined || typeof value.note === "string") &&
		isTemplateVersionSnapshot(value.snapshot)
	);
}

function isTemplateRegistryRecord(
	value: unknown,
): value is TemplateRegistryTemplateRecord {
	return (
		isRecord(value) &&
		typeof value.templateId === "number" &&
		Number.isInteger(value.templateId) &&
		value.templateId > 0 &&
		typeof value.templateName === "string" &&
		(value.activeVersionId === undefined ||
			typeof value.activeVersionId === "string") &&
		(value.headRevision === undefined ||
			(typeof value.headRevision === "number" &&
				Number.isInteger(value.headRevision) &&
				value.headRevision >= 0)) &&
		Array.isArray(value.versions) &&
		value.versions.length > 0 &&
		value.versions.every(isTemplateRegistryVersion)
	);
}

function parseTemplateRegistryStore(value: unknown): TemplateRegistryStore {
	if (!isRecord(value) || value.version !== 1) {
		throw new Error(
			"Invalid template registry store: expected schema version 1",
		);
	}
	if (!isRecord(value.templates)) {
		throw new Error(
			"Invalid template registry store: templates must be a record",
		);
	}
	if (
		value.captureSequence !== undefined &&
		(typeof value.captureSequence !== "number" ||
			!Number.isSafeInteger(value.captureSequence) ||
			value.captureSequence < 0)
	) {
		throw new Error(
			"Invalid template registry store: captureSequence must be a non-negative safe integer",
		);
	}
	for (const [key, record] of Object.entries(value.templates)) {
		if (!isTemplateRegistryRecord(record)) {
			throw new Error(
				`Invalid template registry store: template ${key} failed schema validation`,
			);
		}
	}

	return value as unknown as TemplateRegistryStore;
}

function createTemplateRegistryStore(): JsonFileStore<TemplateRegistryStore> {
	return {
		path: getOpsStorePaths().templateRegistryPath,
		createDefault: () => ({ version: 1, captureSequence: 0, templates: {} }),
		parse: parseTemplateRegistryStore,
		lock: { timeoutMs: TEMPLATE_REGISTRY_LOCK_TIMEOUT_MS },
	};
}

function createTemplateSnapshot(template: Template, fallbackId: number) {
	return {
		id: toPositiveInt(template.id) || fallbackId,
		name: template.name || `Template ${fallbackId}`,
		type: template.type || "campaign",
		subject: template.subject || "",
		body: template.body || "",
		bodySource: template.body_source || undefined,
	} satisfies TemplateVersionSnapshot;
}

function createTemplateHash(snapshot: TemplateVersionSnapshot): string {
	return createHash("sha256")
		.update(
			JSON.stringify({
				name: snapshot.name,
				type: snapshot.type,
				subject: snapshot.subject,
				body: snapshot.body,
				bodySource: snapshot.bodySource || "",
			}),
		)
		.digest("hex");
}

export type TemplateLiveVersionResolution =
	| Readonly<{
			/** Which registry reference identified the live content. */
			status: "active" | "latest";
			version: TemplateRegistryVersion;
	  }>
	| Readonly<{
			status: "drifted";
			/** Older stored versions whose content equals the live template. */
			matchingVersionIds: readonly string[];
	  }>;

/**
 * The snapshot Listmonk stores when the registry writes `snapshot`. Verified
 * against Listmonk 6.2: an update stores a non-transactional template's name
 * as its subject. That is the only rewrite accepted as the written version;
 * any other difference — such as a body_source Listmonk kept — is a
 * different version. Returns `snapshot` itself when the write stores it
 * unchanged.
 */
export function normalizeTemplateSnapshotForWrite(
	snapshot: TemplateVersionSnapshot,
): TemplateVersionSnapshot {
	if (snapshot.type === "tx" || snapshot.subject === snapshot.name) {
		return snapshot;
	}
	return { ...snapshot, subject: snapshot.name };
}

/**
 * Whether live content with `liveHash` is `version`'s content: its stored
 * snapshot, or what Listmonk stores when that snapshot is written.
 */
function versionHoldsLiveContent(
	version: TemplateRegistryVersion,
	liveHash: string,
): boolean {
	if (version.hash === liveHash) {
		return true;
	}
	const written = normalizeTemplateSnapshotForWrite(version.snapshot);
	return written !== version.snapshot && createTemplateHash(written) === liveHash;
}

/**
 * Accept a hash previously reported by a sync or stored in registry history
 * when Listmonk's verified write normalization produced the live content.
 */
function liveTemplateMatchesRemoteHashPin(
	record: Pick<TemplateRegistryTemplateRecord, "versions"> | undefined,
	liveHash: string,
	expectedRemoteHash: string,
): boolean {
	return (
		liveHash === expectedRemoteHash ||
		(record?.versions.some(
			(version) =>
				version.hash === expectedRemoteHash &&
				versionHoldsLiveContent(version, liveHash),
		) ??
			false)
	);
}

/**
 * Resolve which stored version is live in Listmonk from the live content
 * hash. The active version wins when it holds the live content: it
 * disambiguates duplicate content, such as an older version a promotion or
 * rollback made active. Otherwise the latest capture matches when nothing
 * changed since the last capture. Any other live content changed outside the
 * registry since the last sync — even when it equals an older stored
 * version, its position in history is unknown — so it resolves as drift
 * rather than a guess. A sync applies the same rule, so a rollback resolves
 * exactly the version a sync would mark active without recording anything
 * new.
 */
export function resolveTemplateLiveVersion(
	record: Pick<TemplateRegistryTemplateRecord, "activeVersionId" | "versions">,
	liveHash: string,
): TemplateLiveVersionResolution {
	const history = [...record.versions].sort(compareTemplateVersions);
	const activeVersion = history.find(
		(version) => version.versionId === record.activeVersionId,
	);
	if (activeVersion && versionHoldsLiveContent(activeVersion, liveHash)) {
		return { status: "active", version: activeVersion };
	}
	const latestVersion = history.at(-1);
	if (latestVersion && versionHoldsLiveContent(latestVersion, liveHash)) {
		return { status: "latest", version: latestVersion };
	}
	return {
		status: "drifted",
		matchingVersionIds: history
			.filter((version) => versionHoldsLiveContent(version, liveHash))
			.map((version) => version.versionId),
	};
}

/**
 * Select the version a rollback writes: the version captured immediately
 * before the live version. Unpinned, live content the registry cannot place
 * fails closed with {@link TemplateRegistryDriftError}. An explicit
 * `toVersionId` must still equal the selected target, so a pinned retry
 * after an intervening change conflicts instead of rolling elsewhere; under
 * drift the pin authorizes overwriting the unrecorded live content, and the
 * target stays relative to the registry's active version.
 */
export function selectTemplateRollbackTarget(
	record: Pick<
		TemplateRegistryTemplateRecord,
		"templateId" | "activeVersionId" | "versions"
	>,
	liveHash: string,
	toVersionId?: string,
): TemplateRegistryVersion {
	const live = resolveTemplateLiveVersion(record, liveHash);
	if (live.status === "drifted" && toVersionId === undefined) {
		throw new TemplateRegistryDriftError({
			templateId: record.templateId,
			liveHash,
			activeVersionId: record.activeVersionId,
			matchingVersionIds: live.matchingVersionIds,
		});
	}

	const baseVersionId =
		live.status === "drifted" ? record.activeVersionId : live.version.versionId;
	const history = [...record.versions].sort(compareTemplateVersions);
	const baseIndex = history.findIndex(
		(version) => version.versionId === baseVersionId,
	);
	const targetVersion = baseIndex > 0 ? history[baseIndex - 1] : undefined;
	if (!targetVersion) {
		throw new Error(
			`Template ${record.templateId} has no previous version to roll back to`,
		);
	}
	if (toVersionId !== undefined && targetVersion.versionId !== toVersionId) {
		throw new Error(
			`Rollback target ${toVersionId} is no longer the previous version of template ${record.templateId}`,
		);
	}
	return targetVersion;
}

async function getTemplateIds(
	client: ListmonkClient,
	explicitTemplateIds?: number[],
): Promise<number[]> {
	if (explicitTemplateIds && explicitTemplateIds.length > 0) {
		return explicitTemplateIds;
	}

	const response = await client.template.list();
	const templates = extractResults<Template>(
		unwrapResponseData(
			response,
			"Failed to list templates for template registry sync",
		),
	);
	return templates
		.map((template) => toPositiveInt(template.id))
		.filter((templateId): templateId is number => templateId !== undefined);
}

interface CapturedTemplateVersion {
	templateId: number;
	/**
	 * When this template was read, just before its request: a sync reads
	 * templates one by one, so a template late in a long sync is observed well
	 * after the sync began — possibly after an overlapping sync recorded older
	 * content. History and the active version follow this observation order.
	 */
	capturedAt: string;
	captureOrder: number;
	headRevisionBeforeRead: number;
	snapshot: TemplateVersionSnapshot;
	hash: string;
}

interface TemplateRegistryCapture {
	/** When the sync began; each template carries its own observation time. */
	capturedAt: string;
	captureSequence: number;
	versions: CapturedTemplateVersion[];
	errors: string[];
}

interface TemplateRegistryCaptureSequenceStore {
	version: 1;
	captureSequence: number;
}

function createTemplateCaptureSequenceStore(
	storeDefinition: JsonFileStore<TemplateRegistryStore>,
	initialSequence: number,
): JsonFileStore<TemplateRegistryCaptureSequenceStore> {
	return {
		path: `${storeDefinition.path}.capture-sequence.json`,
		createDefault: () => ({ version: 1, captureSequence: initialSequence }),
		parse: (value) => {
			if (
				!isRecord(value) ||
				value.version !== 1 ||
				typeof value.captureSequence !== "number" ||
				!Number.isSafeInteger(value.captureSequence) ||
				value.captureSequence < 0
			) {
				throw new Error("Invalid template registry capture sequence store");
			}
			return value as unknown as TemplateRegistryCaptureSequenceStore;
		},
		lock: storeDefinition.lock,
	};
}

async function reserveTemplateCaptureRead(
	sequenceStore: JsonFileStore<TemplateRegistryCaptureSequenceStore>,
	minimumSequence: number,
): Promise<{ captureOrder: number }> {
	return updateJsonFileStore(sequenceStore, (store) => {
		const captureOrder = Math.max(store.captureSequence, minimumSequence) + 1;
		if (!Number.isSafeInteger(captureOrder)) {
			throw new Error("Template registry capture sequence is exhausted");
		}
		return commitJsonFileStoreUpdate(
			{ version: 1, captureSequence: captureOrder },
			{ captureOrder },
		);
	});
}

/**
 * The per-template lock spans sequence reservation and the remote GET. Its
 * payload stays null, so skipUnchangedWrites creates only the lock sidecar and
 * avoids rewriting a dummy JSON document; reads for other templates proceed.
 */
function createTemplateCaptureReadLockStore(
	storeDefinition: JsonFileStore<TemplateRegistryStore>,
	templateId: number,
): JsonFileStore<null> {
	return {
		path: `${storeDefinition.path}.capture-${templateId}`,
		createDefault: () => null,
		parse: (value) => {
			if (value !== null) {
				throw new Error("Invalid template registry capture lock store");
			}
			return null;
		},
		lock: storeDefinition.lock,
		skipUnchangedWrites: true,
	};
}

async function captureTemplateRegistry(
	client: ListmonkClient,
	options: TemplateRegistrySyncOptions,
	storeDefinition: JsonFileStore<TemplateRegistryStore>,
): Promise<TemplateRegistryCapture> {
	const capturedAt = new Date().toISOString();
	const templateIds = await getTemplateIds(client, options.templateIds);
	const registry = await readJsonFileStore(storeDefinition);
	const captureSequenceHighWater =
		getTemplateRegistryCaptureSequenceHighWater(registry);
	const sequenceStore = createTemplateCaptureSequenceStore(
		storeDefinition,
		captureSequenceHighWater,
	);
	const versions: CapturedTemplateVersion[] = [];
	const errors: string[] = [];

	for (const templateId of templateIds) {
		try {
			const version = await updateJsonFileStore(
				createTemplateCaptureReadLockStore(storeDefinition, templateId),
				async (lockState) => {
					let stamp = await reserveTemplateCaptureRead(
					sequenceStore,
					captureSequenceHighWater,
				);
					const latestRegistry = await readJsonFileStore(storeDefinition);
					const latestCaptureSequence =
						getTemplateRegistryCaptureSequenceHighWater(latestRegistry);
					if (latestCaptureSequence >= stamp.captureOrder) {
						stamp = await reserveTemplateCaptureRead(
							sequenceStore,
							latestCaptureSequence,
						);
					}
					const headRevisionBeforeRead =
						latestRegistry.templates[String(templateId)]?.headRevision ?? 0;
					const capturedAt = new Date().toISOString();
					const template = await getTemplateById(client, templateId);
					const snapshot = createTemplateSnapshot(template, templateId);
					return commitJsonFileStoreUpdate(lockState, {
						templateId,
						...stamp,
						capturedAt,
						headRevisionBeforeRead,
						snapshot,
						hash: createTemplateHash(snapshot),
					});
				},
			);
			versions.push(version);
		} catch (error) {
			try {
				await options.onCaptureError?.({ templateId, error });
			} catch {
				// Diagnostics must never change the registry sync result.
			}
			errors.push(`Template ${templateId}: capture failed`);
		}
	}

	const captureSequence = (await readJsonFileStore(
		sequenceStore,
	)).captureSequence;
	return { capturedAt, captureSequence, versions, errors };
}

/**
 * Whether a sync capture may move the active version. The capture runs
 * outside the store lock, so it can be stale when it merges: a capture not
 * newer than every stored version is superseded by those observations, and a
 * capture that raced a promotion or rollback (the head revision moved while
 * it was in flight) may have observed content that write replaced. A stale
 * capture is still recorded in history, but it never describes what is live.
 * `record.versions` must be in capture order.
 */
function isCurrentTemplateCapture(
	record: TemplateRegistryTemplateRecord,
	capturedAt: string,
	captureOrder: number,
	headRevisionBeforeRead: number,
): boolean {
	const latestVersion = record.versions.at(-1);
	const followsLatest =
		latestVersion === undefined ||
		(latestVersion.captureOrder === undefined
			? latestVersion.capturedAt.localeCompare(capturedAt) < 0 ||
				latestVersion.capturedAt === capturedAt
			: latestVersion.captureOrder < captureOrder);
	return (
		(record.headRevision ?? 0) === headRevisionBeforeRead && followsLatest
	);
}

function mergeTemplateRegistryCapture(
	capture: TemplateRegistryCapture,
	options: TemplateRegistrySyncOptions,
	store: TemplateRegistryStore,
	storePath: string,
): TemplateRegistrySyncResult {
	migrateLegacyTemplateCaptureOrders(store);
	store.captureSequence = Math.max(
		store.captureSequence ?? 0,
		capture.captureSequence,
	);
	let createdVersions = 0;
	let unchangedTemplates = 0;
	const templates: TemplateRegistrySyncResult["templates"] = [];

	for (const {
		templateId,
		capturedAt,
		captureOrder,
		headRevisionBeforeRead,
		snapshot,
		hash,
	} of capture.versions) {
		const key = String(templateId);
		const record = store.templates[key] || {
			templateId,
			templateName: snapshot.name,
			versions: [],
			activeVersionId: undefined,
		};
		record.versions.sort(compareTemplateVersions);
		const isCurrentCapture = isCurrentTemplateCapture(
			record,
			capturedAt,
			captureOrder,
			headRevisionBeforeRead,
		);
		// The active version follows the live content, resolved exactly as a
		// rollback resolves it. Content the active version already holds —
		// possibly an older version a promotion or rollback made active —
		// records nothing: a duplicate capture at the end of history would
		// make the next rollback undo that write. Content matching the latest
		// capture activates it, and anything else is recorded below as a new
		// version. Only a current capture moves the active version.
		const live = resolveTemplateLiveVersion(record, hash);
		if (live.status !== "drifted") {
			if (isCurrentCapture) {
				// The live name: an active older version a promotion restored
				// can carry a different name than the latest capture.
				record.templateName = snapshot.name;
			}
			if (
				live.status === "latest" &&
				(isCurrentCapture || record.activeVersionId === undefined)
			) {
				record.activeVersionId = live.version.versionId;
			}
			unchangedTemplates += 1;
			templates.push({
				templateId,
				templateName: snapshot.name,
				changed: false,
				hash,
				versionId: live.version.versionId,
			});
			store.templates[key] = record;
			continue;
		}

		const versionId = `v_${capturedAt}_${captureOrder}_${hash.slice(0, 10)}`;
		const existingVersion = record.versions.find(
			(version) => version.versionId === versionId,
		);
		if (existingVersion) {
			unchangedTemplates += 1;
			templates.push({
				templateId,
				templateName: snapshot.name,
				changed: false,
				hash,
				versionId: existingVersion.versionId,
			});
			store.templates[key] = record;
			continue;
		}

		record.versions.push({
			versionId,
			capturedAt,
			captureOrder,
			hash,
			note: options.note,
			snapshot,
		});
		record.versions.sort(compareTemplateVersions);
		// Like the active version, the name follows only current captures: a
		// stale one may predate a promotion that restored another name.
		if (isCurrentCapture) {
			record.activeVersionId = versionId;
			record.templateName = snapshot.name;
		} else if (!record.activeVersionId) {
			record.activeVersionId = record.versions.at(-1)?.versionId || versionId;
		}

		store.templates[key] = record;
		createdVersions += 1;
		templates.push({
			templateId,
			templateName: snapshot.name,
			changed: true,
			hash,
			versionId,
		});
	}

	return {
		storePath,
		capturedAt: capture.capturedAt,
		createdVersions,
		unchangedTemplates,
		errors: capture.errors,
		templates,
	};
}

export async function syncTemplateRegistry(
	client: ListmonkClient,
	options: TemplateRegistrySyncOptions = {},
): Promise<TemplateRegistrySyncResult> {
	const storeDefinition = createTemplateRegistryStore();
	const capture = await captureTemplateRegistry(
		client,
		options,
		storeDefinition,
	);
	return updateJsonFileStore(storeDefinition, (store) => {
		const result = mergeTemplateRegistryCapture(
			capture,
			options,
			store,
			storeDefinition.path,
		);
		return commitJsonFileStoreUpdate(store, result);
	});
}

export async function getTemplateRegistryHistory(templateId: number): Promise<{
	storePath: string;
	templateId: number;
	templateName: string;
	activeVersionId?: string;
	headRevision: number;
	versions: TemplateRegistryVersion[];
}> {
	const storeDefinition = createTemplateRegistryStore();
	const store = await readJsonFileStore(storeDefinition);
	const record = store.templates[String(templateId)];
	if (!record) {
		throw new Error(`No registry history for template ${templateId}`);
	}

	return {
		storePath: storeDefinition.path,
		templateId: record.templateId,
		templateName: record.templateName,
		activeVersionId: record.activeVersionId,
		headRevision: record.headRevision ?? 0,
		versions: record.versions,
	};
}

/**
 * Read the live template at most once per registry transaction, so every
 * check inside the store lock works from the same observation.
 */
function createLiveTemplateReader(
	client: ListmonkClient,
	templateId: number,
): () => Promise<Template> {
	let liveTemplate: Promise<Template> | undefined;
	return () => {
		liveTemplate ??= getTemplateById(client, templateId);
		return liveTemplate;
	};
}

/**
 * Listmonk 6.2 keeps a template's body_source when an update omits it or
 * sends it empty or null, so a version without one cannot be restored over
 * a live template that has one: the write would pair the version's body with
 * the live visual-builder source, a state no stored version holds. Refuse
 * before writing instead of reporting that hybrid as the restored version.
 */
function assertTemplateVersionRestorable(
	templateId: number,
	version: TemplateRegistryVersion,
	liveTemplate: Template,
): void {
	if (!version.snapshot.bodySource && liveTemplate.body_source) {
		throw new Error(
			`Template ${templateId} version ${version.versionId} has no body_source, but the live template has one; Listmonk keeps a body_source that an update omits or clears, so writing this version would pair its body with a different visual source. Promote a version that has a body_source, or change the template in Listmonk.`,
		);
	}
}

// Call only from a JSON store transaction. The lock intentionally spans the
// Listmonk update so concurrent CLI/MCP processes cannot commit active versions
// in a different order than their remote template updates. Dead local owners
// are recovered by the shared file-store lock.
async function promoteTemplateVersionInStore(
	client: ListmonkClient,
	templateId: number,
	versionId: string,
	store: TemplateRegistryStore,
	readLiveTemplate: () => Promise<Template>,
): Promise<TemplatePromoteResult> {
	const record = store.templates[String(templateId)];
	if (!record) {
		throw new Error(`No registry history for template ${templateId}`);
	}

	const targetVersion = record.versions.find(
		(version) => version.versionId === versionId,
	);
	if (!targetVersion) {
		throw new Error(
			`Version ${versionId} not found for template ${templateId}`,
		);
	}
	assertTemplateVersionRestorable(
		templateId,
		targetVersion,
		await readLiveTemplate(),
	);

	const response = await client.template.update({
		path: { id: templateId },
		body: {
			name: targetVersion.snapshot.name,
			type: targetVersion.snapshot.type as
				| "campaign"
				| "campaign_visual"
				| "tx",
			subject: targetVersion.snapshot.subject,
			body: targetVersion.snapshot.body,
			body_source: targetVersion.snapshot.bodySource,
		},
	});
	if ("error" in response) {
		throw new Error(
			`Failed to promote template ${templateId}: ${String(response.error)}`,
		);
	}

	// Every registry-managed remote write advances the monotonic head
	// revision — including a same-version re-promotion restoring drifted
	// remote content, which an observer's older pins must not survive.
	// Callers that already carry the target content never reach this write:
	// promoteTemplateVersion short-circuits the already-current case.
	record.headRevision = (record.headRevision ?? 0) + 1;
	record.activeVersionId = versionId;
	// The write restored this version's name in Listmonk.
	record.templateName = targetVersion.snapshot.name;
	store.templates[String(templateId)] = record;

	return {
		templateId,
		templateName: record.templateName,
		versionId,
		activeVersionId: versionId,
		headRevision: record.headRevision ?? 0,
		promotedAt: new Date().toISOString(),
		promoted: true,
	};
}

/**
 * Outcome of a registry mutation action: the operation result plus whether
 * the action actually issued a remote template update. No-op branches
 * (an already-current promotion, an already-applied rollback) never
 * mutated Listmonk, so a local store failure after them must not be
 * reported as an unconfirmed REMOTE commit.
 */
interface TemplateRemoteMutationOutcome<Result> {
	result: Result;
	remoteMutated: boolean;
}

async function commitRemoteTemplateMutation<
	Result extends TemplatePromoteResult | TemplateRollbackResult,
>(
	storeDefinition: JsonFileStore<TemplateRegistryStore>,
	templateId: number,
	action: (
		store: TemplateRegistryStore,
	) => Promise<TemplateRemoteMutationOutcome<Result>>,
): Promise<Result> {
	let remoteMutationCompleted = false;
	try {
		return await updateJsonFileStore(storeDefinition, async (store) => {
			const outcome = await action(store);
			remoteMutationCompleted = outcome.remoteMutated;
			return commitJsonFileStoreUpdate(store, outcome.result);
		});
	} catch (error) {
		if (!remoteMutationCompleted) {
			throw error;
		}

		const causeMessage = error instanceof Error ? error.message : String(error);
		throw new TemplateRegistryWriteTransactionError(
			`Template ${templateId} was updated in Listmonk, but local registry state could not be confirmed. Inspect the remote template and registry before retrying. Cause: ${causeMessage}`,
			error,
		);
	}
}

export async function promoteTemplateVersion(
	client: ListmonkClient,
	templateId: number,
	versionId: string,
	options?: { expectedRemoteHash?: string; force?: boolean },
): Promise<TemplatePromoteResult> {
	const storeDefinition = createTemplateRegistryStore();
	return commitRemoteTemplateMutation(
		storeDefinition,
		templateId,
		async (
			store,
		): Promise<TemplateRemoteMutationOutcome<TemplatePromoteResult>> => {
			const readLiveTemplate = createLiveTemplateReader(client, templateId);
			const record = store.templates[String(templateId)];
			// Hash check inside the lock so concurrent promotions cannot
			// both pass the check before either acquires the lock.
			if (!options?.force && options?.expectedRemoteHash) {
				const remoteTemplate = await readLiveTemplate();
				const remoteHash = createTemplateHash({
					id: toPositiveInt(remoteTemplate.id) || templateId,
					name: remoteTemplate.name || "",
					type: remoteTemplate.type || "campaign",
					subject: remoteTemplate.subject || "",
					body: remoteTemplate.body || "",
					bodySource: remoteTemplate.body_source || undefined,
				} satisfies TemplateVersionSnapshot);
				if (
					!liveTemplateMatchesRemoteHashPin(
						record,
						remoteHash,
						options.expectedRemoteHash,
					)
				) {
					throw new Error(
						`Template ${templateId} remote hash mismatch: expected ${options.expectedRemoteHash.slice(0, 10)}, got ${remoteHash.slice(0, 10)}. Use force=true to override.`,
					);
				}
			}

			// An already-current promotion is a no-op: when the active
			// version's content still matches the remote template, the PUT
			// and the head-revision advance would only invalidate other
			// callers' pins without changing anything. A drifted remote
			// (hash differs) still takes the write below. force skips this
			// short-circuit because it asks for an unconditional write.
			if (!options?.force && record?.activeVersionId === versionId) {
				const activeVersion = record.versions.find(
					(version) => version.versionId === versionId,
				);
				if (activeVersion) {
					const remoteTemplate = await readLiveTemplate();
					const remoteHash = createTemplateHash(
						createTemplateSnapshot(remoteTemplate, templateId),
					);
					if (versionHoldsLiveContent(activeVersion, remoteHash)) {
						return {
							result: {
								templateId,
								templateName: record.templateName,
								versionId,
								activeVersionId: versionId,
								headRevision: record.headRevision ?? 0,
								promotedAt: new Date().toISOString(),
								promoted: false,
							},
							remoteMutated: false,
						};
					}
				}
			}

			return {
				result: await promoteTemplateVersionInStore(
					client,
					templateId,
					versionId,
					store,
					readLiveTemplate,
				),
				remoteMutated: true,
			};
		},
	);
}

export async function rollbackTemplateVersion(
	client: ListmonkClient,
	templateId: number,
	options: {
		/**
		 * Target pin: the version the caller expects the rollback to write.
		 * It must be the version preceding the live one (or already active),
		 * so a retry after the registry moved conflicts instead of rolling
		 * elsewhere. When the live content changed outside the registry, the
		 * pin authorizes overwriting it relative to the active version.
		 */
		toVersionId?: string;
		/**
		 * Source pin: the active version the caller observed; a mismatch
		 * conflicts. A cycle that promotes the original version back restores
		 * this pin's match — pair it with the head pin to catch it.
		 */
		fromVersionId?: string;
		/**
		 * Head pin: the registry head revision the caller observed (echo the
		 * head_revision from the original attempt or registry-history). Unlike
		 * the source pin it survives an A → B → A cycle that restores both the
		 * version id and the remote content, because the counter moved on.
		 */
		expectedHeadRevision?: number;
		/** Remote drift pin: the remote template hash the caller observed. */
		expectedRemoteHash?: string;
	} = {},
): Promise<TemplateRollbackResult> {
	const storeDefinition = createTemplateRegistryStore();
	return commitRemoteTemplateMutation(
		storeDefinition,
		templateId,
		async (
			store,
		): Promise<TemplateRemoteMutationOutcome<TemplateRollbackResult>> => {
			const record = store.templates[String(templateId)];
			if (!record || record.versions.length < 2) {
				throw new Error(
					`Rollback requires at least 2 versions for template ${templateId}`,
				);
			}

			// The head revision pin catches cycles the source pin cannot:
			// promoting the original version back restores both the active
			// version id and (for identical content) the remote hash, so only
			// the monotonic counter proves the registry moved A → B → A. It
			// is checked first because it is the cheapest exact match.
			if (
				options.expectedHeadRevision !== undefined &&
				(record.headRevision ?? 0) !== options.expectedHeadRevision
			) {
				throw new Error(
					`Rollback head revision pin ${options.expectedHeadRevision} no longer matches registry head ${record.headRevision ?? 0} of template ${templateId}; the registry changed since the echoed attempt`,
				);
			}

			// A source pin conflicts whenever the active version moved
			// elsewhere; the one transition it cannot see is the cycle that
			// promotes the original version back, which is exactly what the
			// head-revision pin above catches.
			if (
				options.fromVersionId !== undefined &&
				record.activeVersionId !== options.fromVersionId
			) {
				throw new Error(
					`Rollback source pin ${options.fromVersionId} no longer matches the active version ${String(record.activeVersionId)} of template ${templateId}`,
				);
			}

			const readLiveTemplate = createLiveTemplateReader(client, templateId);
			// Remote drift pin: same locked hash check as promotion, so a
			// template mutated outside the registry cannot be rolled back
			// over silently. Listmonk offers no conditional update, so this
			// stays a best-effort pre-check — an external writer can still
			// interleave between this GET and the update PUT below.
			if (options.expectedRemoteHash !== undefined) {
				const remoteTemplate = await readLiveTemplate();
				const remoteHash = createTemplateHash({
					id: toPositiveInt(remoteTemplate.id) || templateId,
					name: remoteTemplate.name || "",
					type: remoteTemplate.type || "campaign",
					subject: remoteTemplate.subject || "",
					body: remoteTemplate.body || "",
					bodySource: remoteTemplate.body_source || undefined,
				} satisfies TemplateVersionSnapshot);
				if (
					!liveTemplateMatchesRemoteHashPin(
						record,
						remoteHash,
						options.expectedRemoteHash,
					)
				) {
					throw new Error(
						`Template ${templateId} remote hash mismatch: expected ${options.expectedRemoteHash.slice(0, 10)}, got ${remoteHash.slice(0, 10)}`,
					);
				}
			}

			// A pinned target that already equals the active version is the
			// already-applied case even when no further previous version
			// exists, so check it before resolving the dynamic target. But
			// "already applied" must also hold remotely: when the registry
			// still marks the target active while the remote template
			// drifted elsewhere, the rollback is repaired by re-promoting
			// the target instead of being reported as a no-op.
			if (
				options.toVersionId !== undefined &&
				record.activeVersionId === options.toVersionId
			) {
				const targetVersion = record.versions.find(
					(version) => version.versionId === options.toVersionId,
				);
				if (targetVersion) {
					const remoteTemplate = await readLiveTemplate();
					const remoteHash = createTemplateHash(
						createTemplateSnapshot(remoteTemplate, templateId),
					);
					if (!versionHoldsLiveContent(targetVersion, remoteHash)) {
						const promoted = await promoteTemplateVersionInStore(
							client,
							templateId,
							targetVersion.versionId,
							store,
							readLiveTemplate,
						);
						return {
							result: { ...promoted, rolledBack: true },
							remoteMutated: true,
						};
					}
				}
				return {
					result: {
						templateId,
						templateName: record.templateName,
						versionId: options.toVersionId,
						activeVersionId: record.activeVersionId,
						headRevision: record.headRevision ?? 0,
						promotedAt: new Date().toISOString(),
						rolledBack: false,
					},
					remoteMutated: false,
				};
			}

			// Roll back from what is live in Listmonk, not from the stored
			// pointer alone: the template may have changed since the registry
			// last observed it. The live version is resolved the way a sync
			// would mark it active, and live content the registry cannot place
			// fails closed unless an explicit target pins the rollback. The
			// pinned target must still be the resolved previous version, so a
			// retry after the registry moved fails instead of silently rolling
			// to a different version.
			const remoteTemplate = await readLiveTemplate();
			const targetVersion = selectTemplateRollbackTarget(
				record,
				createTemplateHash(createTemplateSnapshot(remoteTemplate, templateId)),
				options.toVersionId,
			);

			const promoted = await promoteTemplateVersionInStore(
				client,
				templateId,
				targetVersion.versionId,
				store,
				readLiveTemplate,
			);
			return { result: { ...promoted, rolledBack: true }, remoteMutated: true };
		},
	);
}
