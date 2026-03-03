import { createHash } from "node:crypto";

import type { ListmonkClient, Template } from "@listmonk-ops/openapi";

import { getTemplateById } from "./api";
import {
	extractResults,
	readJsonFile,
	TEMPLATE_REGISTRY_PATH,
	toPositiveInt,
	writeJsonFile,
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

async function loadTemplateRegistryStore(): Promise<TemplateRegistryStore> {
	return readJsonFile<TemplateRegistryStore>(TEMPLATE_REGISTRY_PATH, {
		version: 1,
		templates: {},
	});
}

async function saveTemplateRegistryStore(
	store: TemplateRegistryStore,
): Promise<void> {
	await writeJsonFile(TEMPLATE_REGISTRY_PATH, store);
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
	const templates = extractResults<Template>(response.data);
	return templates
		.map((template) => toPositiveInt(template.id))
		.filter((templateId): templateId is number => templateId !== undefined);
}

export async function syncTemplateRegistry(
	client: ListmonkClient,
	options: TemplateRegistrySyncOptions = {},
): Promise<TemplateRegistrySyncResult> {
	const store = await loadTemplateRegistryStore();
	const capturedAt = new Date().toISOString();
	const templateIds = await getTemplateIds(client, options.templateIds);
	let createdVersions = 0;
	let unchangedTemplates = 0;
	const errors: string[] = [];
	const templates: TemplateRegistrySyncResult["templates"] = [];

	for (const templateId of templateIds) {
		try {
			const template = await getTemplateById(client, templateId);
			const snapshot = createTemplateSnapshot(template, templateId);
			const hash = createTemplateHash(snapshot);
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

			const versionId = `v_${capturedAt}_${hash.slice(0, 10)}`;
			record.templateName = snapshot.name;
			record.versions.push({
				versionId,
				capturedAt,
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
		} catch (error) {
			errors.push(
				`Template ${templateId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	await saveTemplateRegistryStore(store);

	return {
		storePath: TEMPLATE_REGISTRY_PATH,
		capturedAt,
		createdVersions,
		unchangedTemplates,
		errors,
		templates,
	};
}

export async function getTemplateRegistryHistory(templateId: number): Promise<{
	storePath: string;
	templateId: number;
	templateName: string;
	activeVersionId?: string;
	versions: TemplateRegistryVersion[];
}> {
	const store = await loadTemplateRegistryStore();
	const record = store.templates[String(templateId)];
	if (!record) {
		throw new Error(`No registry history for template ${templateId}`);
	}

	return {
		storePath: TEMPLATE_REGISTRY_PATH,
		templateId: record.templateId,
		templateName: record.templateName,
		activeVersionId: record.activeVersionId,
		versions: record.versions,
	};
}

export async function promoteTemplateVersion(
	client: ListmonkClient,
	templateId: number,
	versionId: string,
): Promise<TemplatePromoteResult> {
	const store = await loadTemplateRegistryStore();
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
	await saveTemplateRegistryStore(store);

	return {
		templateId,
		templateName: record.templateName,
		versionId,
		activeVersionId: versionId,
		promotedAt: new Date().toISOString(),
	};
}

export async function rollbackTemplateVersion(
	client: ListmonkClient,
	templateId: number,
): Promise<TemplatePromoteResult> {
	const store = await loadTemplateRegistryStore();
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

	return promoteTemplateVersion(client, templateId, targetVersion.versionId);
}
