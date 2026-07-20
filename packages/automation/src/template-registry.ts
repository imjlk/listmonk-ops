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
	hash: string;
	note?: string;
	snapshot: TemplateVersionSnapshot;
}

export interface TemplateRegistryTemplateRecord {
	templateId: number;
	templateName: string;
	activeVersionId?: string;
	versions: TemplateRegistryVersion[];
}

export interface TemplateRegistryStore {
	version: 1;
	templates: Record<string, TemplateRegistryTemplateRecord>;
}

export interface TemplateRegistrySyncOptions {
	templateIds?: number[];
	note?: string;
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
	promotedAt: string;
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
		createDefault: () => ({ version: 1, templates: {} }),
		parse: parseTemplateRegistryStore,
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
	snapshot: TemplateVersionSnapshot;
	hash: string;
}

interface TemplateRegistryCapture {
	capturedAt: string;
	versions: CapturedTemplateVersion[];
	errors: string[];
}

async function captureTemplateRegistry(
	client: ListmonkClient,
	options: TemplateRegistrySyncOptions,
): Promise<TemplateRegistryCapture> {
	const capturedAt = new Date().toISOString();
	const templateIds = await getTemplateIds(client, options.templateIds);
	const versions: CapturedTemplateVersion[] = [];
	const errors: string[] = [];

	for (const templateId of templateIds) {
		try {
			const template = await getTemplateById(client, templateId);
			const snapshot = createTemplateSnapshot(template, templateId);
			versions.push({
				templateId,
				snapshot,
				hash: createTemplateHash(snapshot),
			});
		} catch (error) {
			errors.push(
				`Template ${templateId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	return { capturedAt, versions, errors };
}

function mergeTemplateRegistryCapture(
	capture: TemplateRegistryCapture,
	options: TemplateRegistrySyncOptions,
	store: TemplateRegistryStore,
	storePath: string,
): TemplateRegistrySyncResult {
	let createdVersions = 0;
	let unchangedTemplates = 0;
	const templates: TemplateRegistrySyncResult["templates"] = [];

	for (const { templateId, snapshot, hash } of capture.versions) {
		const key = String(templateId);
		const record = store.templates[key] || {
			templateId,
			templateName: snapshot.name,
			versions: [],
			activeVersionId: undefined,
		};
		const latestVersion = record.versions.at(-1);
		if (latestVersion?.hash === hash) {
			unchangedTemplates += 1;
			templates.push({
				templateId,
				templateName: snapshot.name,
				changed: false,
				hash,
				versionId: latestVersion.versionId,
			});
			store.templates[key] = record;
			continue;
		}

		const versionId = `v_${capture.capturedAt}_${hash.slice(0, 10)}`;
		record.templateName = snapshot.name;
		record.versions.push({
			versionId,
			capturedAt: capture.capturedAt,
			hash,
			note: options.note,
			snapshot,
		});
		if (!record.activeVersionId) {
			record.activeVersionId = versionId;
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
	const capture = await captureTemplateRegistry(client, options);
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
		versions: record.versions,
	};
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

	record.activeVersionId = versionId;
	store.templates[String(templateId)] = record;

	return {
		templateId,
		templateName: record.templateName,
		versionId,
		activeVersionId: versionId,
		promotedAt: new Date().toISOString(),
	};
}

export async function promoteTemplateVersion(
	client: ListmonkClient,
	templateId: number,
	versionId: string,
): Promise<TemplatePromoteResult> {
	const storeDefinition = createTemplateRegistryStore();
	return updateJsonFileStore(storeDefinition, async (store) => {
		const result = await promoteTemplateVersionInStore(
			client,
			templateId,
			versionId,
			store,
		);
		return commitJsonFileStoreUpdate(store, result);
	});
}

export async function rollbackTemplateVersion(
	client: ListmonkClient,
	templateId: number,
): Promise<TemplatePromoteResult> {
	const storeDefinition = createTemplateRegistryStore();
	return updateJsonFileStore(storeDefinition, async (store) => {
		const record = store.templates[String(templateId)];
		if (!record || record.versions.length < 2) {
			throw new Error(
				`Rollback requires at least 2 versions for template ${templateId}`,
			);
		}

		let targetIndex = record.versions.length - 2;
		if (record.activeVersionId) {
			const activeIndex = record.versions.findIndex(
				(version) => version.versionId === record.activeVersionId,
			);
			if (activeIndex > 0) {
				targetIndex = activeIndex - 1;
			}
		}

		const targetVersion = record.versions[targetIndex];
		if (!targetVersion) {
			throw new Error(
				`Unable to locate rollback target for template ${templateId}`,
			);
		}

		const result = await promoteTemplateVersionInStore(
			client,
			templateId,
			targetVersion.versionId,
			store,
		);
		return commitJsonFileStoreUpdate(store, result);
	});
}
