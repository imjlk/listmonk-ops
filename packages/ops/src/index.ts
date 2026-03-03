import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
	Campaign,
	List,
	ListmonkClient,
	Subscriber,
	Template,
} from "@listmonk-ops/openapi";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPositiveInt(value: unknown): number | undefined {
	const num = typeof value === "number" ? value : Number(value);
	if (!Number.isInteger(num) || num <= 0) {
		return undefined;
	}
	return num;
}

function extractResults<T>(payload: unknown): T[] {
	if (Array.isArray(payload)) {
		return payload as T[];
	}

	if (isRecord(payload) && Array.isArray(payload.results)) {
		return payload.results as T[];
	}

	return [];
}

function toDate(value: string | undefined): Date | undefined {
	if (!value) {
		return undefined;
	}

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return undefined;
	}

	return date;
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
	try {
		const raw = await readFile(path, "utf8");
		return JSON.parse(raw) as T;
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			return fallback;
		}
		throw error;
	}
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const DEFAULT_DATA_DIR = join(
	process.env.HOME || process.cwd(),
	".listmonk-ops",
	"ops",
);

const SEGMENT_STORE_PATH =
	process.env.LISTMONK_OPS_SEGMENT_STORE ||
	join(DEFAULT_DATA_DIR, "segment-drift.json");
const TEMPLATE_REGISTRY_PATH =
	process.env.LISTMONK_OPS_TEMPLATE_REGISTRY ||
	join(DEFAULT_DATA_DIR, "template-registry.json");

export function getOpsStorePaths() {
	return {
		segmentStorePath: SEGMENT_STORE_PATH,
		templateRegistryPath: TEMPLATE_REGISTRY_PATH,
	};
}

export type CheckLevel = "pass" | "warn" | "fail";

export interface CampaignPreflightCheck {
	id: string;
	level: CheckLevel;
	message: string;
	details?: Record<string, unknown>;
}

export interface CampaignPreflightResult {
	campaignId: number;
	campaignName: string;
	status: string;
	audienceEstimate: number;
	checkedAt: string;
	checks: CampaignPreflightCheck[];
	summary: {
		pass: number;
		warn: number;
		fail: number;
	};
}

export interface CampaignPreflightOptions {
	maxAudience?: number;
	checkLinks?: boolean;
	linkCheckTimeoutMs?: number;
}

function summarizeChecks(checks: CampaignPreflightCheck[]) {
	return {
		pass: checks.filter((check) => check.level === "pass").length,
		warn: checks.filter((check) => check.level === "warn").length,
		fail: checks.filter((check) => check.level === "fail").length,
	};
}

function collectBodyLinks(body: string): string[] {
	const matches = body.match(/https?:\/\/[^\s"'<>()]+/g) || [];
	return Array.from(new Set(matches));
}

async function checkLink(
	url: string,
	timeoutMs: number,
): Promise<{
	url: string;
	ok: boolean;
	status?: number;
	error?: string;
}> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		let response = await fetch(url, {
			method: "HEAD",
			redirect: "follow",
			signal: controller.signal,
		});

		if (response.status === 405 || response.status === 501) {
			response = await fetch(url, {
				method: "GET",
				redirect: "follow",
				signal: controller.signal,
			});
		}

		return {
			url,
			ok: response.status < 400,
			status: response.status,
		};
	} catch (error) {
		return {
			url,
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		clearTimeout(timeout);
	}
}

async function getCampaign(client: ListmonkClient, campaignId: number) {
	const response = await client.campaign.getById({
		path: { id: campaignId },
	});

	if ("error" in response) {
		throw new Error(
			`Failed to fetch campaign ${campaignId}: ${response.error}`,
		);
	}

	return response.data || ({} as Campaign);
}

async function getListById(client: ListmonkClient, listId: number) {
	const response = await client.list.getById({
		path: { list_id: listId },
	});
	if ("error" in response) {
		throw new Error(`Failed to fetch list ${listId}: ${response.error}`);
	}
	return response.data || ({} as List);
}

function getCampaignListIds(campaign: Campaign): number[] {
	return (campaign.lists || [])
		.map((entry) => toPositiveInt(entry.id))
		.filter((value): value is number => value !== undefined);
}

export async function runCampaignPreflight(
	client: ListmonkClient,
	campaignId: number,
	options: CampaignPreflightOptions = {},
): Promise<CampaignPreflightResult> {
	const maxAudience = options.maxAudience ?? 200_000;
	const linkCheckTimeoutMs = options.linkCheckTimeoutMs ?? 4_000;
	const checkLinks = options.checkLinks ?? false;
	const checks: CampaignPreflightCheck[] = [];
	const campaign = await getCampaign(client, campaignId);

	const campaignName = campaign.name?.trim() || `Campaign ${campaignId}`;
	const status = campaign.status || "unknown";
	const subject = campaign.subject?.trim() || "";
	const body = campaign.body || "";
	const listIds = getCampaignListIds(campaign);

	if (subject.length > 0) {
		checks.push({
			id: "subject_present",
			level: "pass",
			message: "Subject is present",
		});
	} else {
		checks.push({
			id: "subject_present",
			level: "fail",
			message: "Subject is empty",
		});
	}

	if (body.trim().length > 0) {
		checks.push({
			id: "body_present",
			level: "pass",
			message: "Body content exists",
		});
	} else {
		checks.push({
			id: "body_present",
			level: "fail",
			message: "Body is empty",
		});
	}

	if (body.toLowerCase().includes("unsubscribe")) {
		checks.push({
			id: "unsubscribe_link",
			level: "pass",
			message: "Unsubscribe marker found in body",
		});
	} else {
		checks.push({
			id: "unsubscribe_link",
			level: "fail",
			message: "Unsubscribe marker not found in body",
		});
	}

	const openBraces = body.match(/{{/g)?.length ?? 0;
	const closeBraces = body.match(/}}/g)?.length ?? 0;
	if (openBraces === closeBraces) {
		checks.push({
			id: "template_tokens",
			level: "pass",
			message: "Template token braces are balanced",
		});
	} else {
		checks.push({
			id: "template_tokens",
			level: "fail",
			message: "Template token braces are unbalanced",
			details: { openBraces, closeBraces },
		});
	}

	if (listIds.length === 0) {
		checks.push({
			id: "target_lists",
			level: "fail",
			message: "Campaign has no target lists",
		});
	}

	let audienceEstimate = 0;
	for (const listId of listIds) {
		const list = await getListById(client, listId);
		audienceEstimate += Math.max(0, Number(list.subscriber_count || 0));
	}

	checks.push({
		id: "audience_estimate",
		level:
			audienceEstimate > maxAudience
				? "warn"
				: audienceEstimate === 0
					? "fail"
					: "pass",
		message:
			audienceEstimate > maxAudience
				? `Audience estimate ${audienceEstimate.toLocaleString()} exceeds threshold ${maxAudience.toLocaleString()}`
				: audienceEstimate === 0
					? "Audience estimate is zero"
					: `Audience estimate ${audienceEstimate.toLocaleString()} is within threshold`,
		details: { audienceEstimate, maxAudience },
	});

	const sendStatuses = new Set(["running", "finished"]);
	checks.push({
		id: "status_gate",
		level: sendStatuses.has(status) ? "warn" : "pass",
		message: sendStatuses.has(status)
			? `Campaign is already in ${status} state`
			: `Campaign status ${status} is preflight-safe`,
	});

	if (campaign.template_id) {
		try {
			const templateResponse = await client.template.getById({
				path: { id: campaign.template_id },
			});
			if ("error" in templateResponse || !templateResponse.data?.id) {
				checks.push({
					id: "template_reference",
					level: "fail",
					message: `Template ${campaign.template_id} is not accessible`,
				});
			} else {
				checks.push({
					id: "template_reference",
					level: "pass",
					message: `Template ${campaign.template_id} is accessible`,
				});
			}
		} catch (error) {
			checks.push({
				id: "template_reference",
				level: "fail",
				message: `Template ${campaign.template_id} lookup failed`,
				details: {
					error: error instanceof Error ? error.message : String(error),
				},
			});
		}
	} else {
		checks.push({
			id: "template_reference",
			level: "warn",
			message: "No template_id configured on campaign",
		});
	}

	if (checkLinks) {
		const links = collectBodyLinks(body).slice(0, 20);
		if (links.length === 0) {
			checks.push({
				id: "link_health",
				level: "warn",
				message: "No http(s) links found in campaign body",
			});
		} else {
			const linkResults = await Promise.all(
				links.map((url) => checkLink(url, linkCheckTimeoutMs)),
			);
			const brokenLinks = linkResults.filter((entry) => !entry.ok);
			checks.push({
				id: "link_health",
				level: brokenLinks.length > 0 ? "warn" : "pass",
				message:
					brokenLinks.length > 0
						? `${brokenLinks.length} link(s) failed health check`
						: `${linkResults.length} link(s) passed health check`,
				details: {
					checked: linkResults.length,
					broken: brokenLinks,
				},
			});
		}
	}

	return {
		campaignId,
		campaignName,
		status,
		audienceEstimate,
		checkedAt: new Date().toISOString(),
		checks,
		summary: summarizeChecks(checks),
	};
}

export interface DeliverabilityGuardOptions {
	bounceThreshold?: number;
	openRateThreshold?: number;
	clickRateThreshold?: number;
	pauseOnBreach?: boolean;
}

export interface DeliverabilityGuardResult {
	campaignId: number;
	campaignName: string;
	status: string;
	checkedAt: string;
	metrics: {
		sent: number;
		toSend: number;
		views: number;
		clicks: number;
		bounces: number;
		bounceRate: number;
		openRate: number;
		clickRate: number;
	};
	thresholds: {
		bounceRate: number;
		openRate: number;
		clickRate: number;
	};
	breaches: string[];
	paused: boolean;
}

function getBounceCount(payload: unknown): number {
	const results = extractResults<RecordValue>(payload);
	return results.length;
}

export async function evaluateDeliverabilityGuard(
	client: ListmonkClient,
	campaignId: number,
	options: DeliverabilityGuardOptions = {},
): Promise<DeliverabilityGuardResult> {
	const thresholds = {
		bounceRate: options.bounceThreshold ?? 0.05,
		openRate: options.openRateThreshold ?? 0.08,
		clickRate: options.clickRateThreshold ?? 0.01,
	};
	const campaign = await getCampaign(client, campaignId);
	const campaignName = campaign.name?.trim() || `Campaign ${campaignId}`;
	const sent = Math.max(0, Number(campaign.sent || 0));
	const toSend = Math.max(0, Number(campaign.to_send || 0));
	const views = Math.max(0, Number(campaign.views || 0));
	const clicks = Math.max(0, Number(campaign.clicks || 0));
	const status = campaign.status || "unknown";

	const bounceResponse = await client.bounce.list({
		campaign_id: campaignId,
		per_page: "all",
	});
	const bounces = getBounceCount(bounceResponse.data);
	const bounceRate = sent > 0 ? bounces / sent : 0;
	const openRate = sent > 0 ? views / sent : 0;
	const clickRate = sent > 0 ? clicks / sent : 0;

	const breaches: string[] = [];
	if (bounceRate > thresholds.bounceRate) {
		breaches.push(
			`Bounce rate ${(bounceRate * 100).toFixed(2)}% is above ${(thresholds.bounceRate * 100).toFixed(2)}%`,
		);
	}

	if (sent > 0 && openRate < thresholds.openRate) {
		breaches.push(
			`Open rate ${(openRate * 100).toFixed(2)}% is below ${(thresholds.openRate * 100).toFixed(2)}%`,
		);
	}

	if (sent > 0 && clickRate < thresholds.clickRate) {
		breaches.push(
			`Click rate ${(clickRate * 100).toFixed(2)}% is below ${(thresholds.clickRate * 100).toFixed(2)}%`,
		);
	}

	let paused = false;
	if (
		options.pauseOnBreach &&
		breaches.length > 0 &&
		(status === "running" || status === "scheduled")
	) {
		await client.campaign.updateStatus({
			path: { id: campaignId },
			body: { status: "paused" },
		});
		paused = true;
	}

	return {
		campaignId,
		campaignName,
		status,
		checkedAt: new Date().toISOString(),
		metrics: {
			sent,
			toSend,
			views,
			clicks,
			bounces,
			bounceRate,
			openRate,
			clickRate,
		},
		thresholds,
		breaches,
		paused,
	};
}

export type SubscriberHygieneMode = "winback" | "sunset";

export interface SubscriberHygieneOptions {
	mode?: SubscriberHygieneMode;
	inactivityDays?: number;
	sourceListIds?: number[];
	targetListId?: number;
	blocklist?: boolean;
	dryRun?: boolean;
	maxSubscribers?: number;
}

export interface SubscriberHygieneResult {
	mode: SubscriberHygieneMode;
	cutoffAt: string;
	dryRun: boolean;
	totalSubscribersScanned: number;
	candidateSubscribers: number;
	processedSubscribers: number;
	skippedDueToLimit: number;
	targetListId?: number;
	blocklist: boolean;
	sample: Array<{
		id: number;
		email: string;
		updated_at?: string;
	}>;
	errors: string[];
}

function intersects(source: number[], target: Set<number>): boolean {
	return source.some((value) => target.has(value));
}

export async function runSubscriberHygiene(
	client: ListmonkClient,
	options: SubscriberHygieneOptions = {},
): Promise<SubscriberHygieneResult> {
	const mode = options.mode ?? "winback";
	const inactivityDays = Math.max(1, options.inactivityDays ?? 90);
	const dryRun = options.dryRun ?? true;
	const blocklist = options.blocklist ?? false;
	const maxSubscribers = Math.max(1, options.maxSubscribers ?? 500);
	const cutoffDate = new Date(
		Date.now() - inactivityDays * 24 * 60 * 60 * 1000,
	);
	const sourceListSet = new Set(options.sourceListIds || []);
	const errors: string[] = [];

	const subscriberResponse = await client.subscriber.list({
		query: {
			per_page: "all",
		},
	});
	const subscribers = extractResults<Subscriber>(subscriberResponse.data);

	const candidates = subscribers.filter((subscriber) => {
		const subscriberId = toPositiveInt(subscriber.id);
		if (!subscriberId) {
			return false;
		}

		if (String(subscriber.status || "").toLowerCase() !== "enabled") {
			return false;
		}

		const updatedAt = toDate(subscriber.updated_at || subscriber.created_at);
		if (!updatedAt || updatedAt > cutoffDate) {
			return false;
		}

		if (sourceListSet.size > 0) {
			const subscriberListIds = (subscriber.lists || [])
				.map((entry) => toPositiveInt(entry.id))
				.filter((value): value is number => value !== undefined);
			return intersects(subscriberListIds, sourceListSet);
		}

		return true;
	});

	const selected = candidates.slice(0, maxSubscribers);
	const skippedDueToLimit = Math.max(0, candidates.length - selected.length);
	let processedSubscribers = 0;

	if (!dryRun) {
		if (!options.targetListId && !blocklist) {
			throw new Error(
				"targetListId or blocklist=true is required when dryRun=false",
			);
		}

		for (const candidate of selected) {
			const id = toPositiveInt(candidate.id);
			if (!id) {
				continue;
			}

			try {
				if (options.targetListId) {
					await client.subscriber.manageListById({
						path: { id },
						body: {
							action: "add",
							target_list_ids: options.targetListId,
						},
					});
				}

				if (mode === "sunset" && blocklist) {
					await client.subscriber.manageBlocklistById({
						path: { id },
						body: {
							action: "add",
						},
					});
				}

				processedSubscribers += 1;
			} catch (error) {
				errors.push(
					`Subscriber ${id}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}

	return {
		mode,
		cutoffAt: cutoffDate.toISOString(),
		dryRun,
		totalSubscribersScanned: subscribers.length,
		candidateSubscribers: candidates.length,
		processedSubscribers: dryRun ? 0 : processedSubscribers,
		skippedDueToLimit,
		targetListId: options.targetListId,
		blocklist,
		sample: selected.slice(0, 20).map((candidate) => ({
			id: Number(candidate.id),
			email: candidate.email || "",
			updated_at: candidate.updated_at,
		})),
		errors,
	};
}

export interface SegmentSnapshotEntry {
	capturedAt: string;
	listId: number;
	listName: string;
	subscriberCount: number;
}

export interface SegmentDriftStore {
	version: 1;
	snapshots: SegmentSnapshotEntry[];
}

export interface SegmentDriftOptions {
	listIds?: number[];
	threshold?: number;
	minAbsoluteChange?: number;
	lookbackDays?: number;
}

export interface SegmentDriftComparison {
	listId: number;
	listName: string;
	previousCount?: number;
	currentCount: number;
	baselineCount?: number;
	delta?: number;
	deltaRate?: number;
	alert: boolean;
}

export interface SegmentDriftResult {
	capturedAt: string;
	storePath: string;
	threshold: number;
	minAbsoluteChange: number;
	comparisons: SegmentDriftComparison[];
	alerts: SegmentDriftComparison[];
}

async function loadSegmentStore(): Promise<SegmentDriftStore> {
	return readJsonFile<SegmentDriftStore>(SEGMENT_STORE_PATH, {
		version: 1,
		snapshots: [],
	});
}

async function saveSegmentStore(store: SegmentDriftStore): Promise<void> {
	await writeJsonFile(SEGMENT_STORE_PATH, store);
}

async function getListsForDrift(
	client: ListmonkClient,
	listIds?: number[],
): Promise<List[]> {
	if (listIds && listIds.length > 0) {
		const lists: List[] = [];
		for (const listId of listIds) {
			lists.push(await getListById(client, listId));
		}
		return lists;
	}

	const response = await client.list.list({
		query: { per_page: "all" },
	});
	return extractResults<List>(response.data);
}

export async function runSegmentDriftSnapshot(
	client: ListmonkClient,
	options: SegmentDriftOptions = {},
): Promise<SegmentDriftResult> {
	const threshold = Math.max(0, options.threshold ?? 0.2);
	const minAbsoluteChange = Math.max(0, options.minAbsoluteChange ?? 50);
	const lookbackDays = Math.max(1, options.lookbackDays ?? 14);
	const capturedAt = new Date().toISOString();
	const lists = await getListsForDrift(client, options.listIds);
	const store = await loadSegmentStore();

	const currentEntries: SegmentSnapshotEntry[] = lists
		.map((list) => {
			const id = toPositiveInt(list.id);
			if (!id) {
				return undefined;
			}
			return {
				capturedAt,
				listId: id,
				listName: list.name || `List ${id}`,
				subscriberCount: Math.max(0, Number(list.subscriber_count || 0)),
			};
		})
		.filter((entry): entry is SegmentSnapshotEntry => entry !== undefined);

	const lookbackCutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;

	const comparisons: SegmentDriftComparison[] = currentEntries.map((entry) => {
		const history = store.snapshots
			.filter((snapshot) => snapshot.listId === entry.listId)
			.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
		const previous = history.at(-1);
		const lookbackHistory = history.filter((snapshot) => {
			const time = new Date(snapshot.capturedAt).getTime();
			return !Number.isNaN(time) && time >= lookbackCutoff;
		});
		const baselineCount =
			lookbackHistory.length > 0
				? Math.round(
						lookbackHistory.reduce(
							(sum, snapshot) => sum + snapshot.subscriberCount,
							0,
						) / lookbackHistory.length,
					)
				: undefined;
		const previousCount = previous?.subscriberCount;
		const delta =
			previousCount === undefined
				? undefined
				: entry.subscriberCount - previousCount;
		const deltaRate =
			previousCount === undefined
				? undefined
				: previousCount > 0
					? (entry.subscriberCount - previousCount) / previousCount
					: entry.subscriberCount > 0
						? 1
						: 0;
		const alert =
			delta !== undefined &&
			deltaRate !== undefined &&
			Math.abs(delta) >= minAbsoluteChange &&
			Math.abs(deltaRate) >= threshold;

		return {
			listId: entry.listId,
			listName: entry.listName,
			previousCount,
			currentCount: entry.subscriberCount,
			baselineCount,
			delta,
			deltaRate,
			alert,
		};
	});

	store.snapshots.push(...currentEntries);
	await saveSegmentStore(store);

	return {
		capturedAt,
		storePath: SEGMENT_STORE_PATH,
		threshold,
		minAbsoluteChange,
		comparisons,
		alerts: comparisons.filter((comparison) => comparison.alert),
	};
}

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

async function getTemplateById(client: ListmonkClient, templateId: number) {
	const response = await client.template.getById({
		path: { id: templateId },
	});
	if ("error" in response) {
		throw new Error(
			`Failed to fetch template ${templateId}: ${response.error}`,
		);
	}
	return response.data || ({} as Template);
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

export interface DailyDigestOptions {
	hours?: number;
	bounceThreshold?: number;
	openRateThreshold?: number;
	clickRateThreshold?: number;
}

export interface DailyDigestResult {
	generatedAt: string;
	window: {
		hours: number;
		from: string;
		to: string;
	};
	metrics: {
		lists: number;
		subscribers: number;
		subscriberStatus: Record<string, number>;
		campaigns: number;
		runningCampaigns: number;
		campaignsCreatedInWindow: number;
		sent: number;
		views: number;
		clicks: number;
		bouncesInWindow: number;
	};
	risk: {
		campaignBreaches: Array<{
			campaignId: number;
			campaignName: string;
			breaches: string[];
		}>;
	};
	markdown: string;
}

function countBy<T>(
	items: T[],
	getKey: (item: T) => string,
): Record<string, number> {
	return items.reduce<Record<string, number>>((acc, item) => {
		const key = getKey(item);
		acc[key] = (acc[key] || 0) + 1;
		return acc;
	}, {});
}

export async function generateDailyDigest(
	client: ListmonkClient,
	options: DailyDigestOptions = {},
): Promise<DailyDigestResult> {
	const hours = Math.max(1, options.hours ?? 24);
	const now = new Date();
	const from = new Date(now.getTime() - hours * 60 * 60 * 1000);

	const [
		listsResponse,
		subscribersResponse,
		campaignsResponse,
		bouncesResponse,
	] = await Promise.all([
		client.list.list({ query: { per_page: "all" } }),
		client.subscriber.list({ query: { per_page: "all" } }),
		client.campaign.list({ query: { per_page: "all" } }),
		client.bounce.list({ per_page: "all" }),
	]);

	const lists = extractResults<List>(listsResponse.data);
	const subscribers = extractResults<Subscriber>(subscribersResponse.data);
	const campaigns = extractResults<Campaign>(campaignsResponse.data);
	const bounces = extractResults<RecordValue>(bouncesResponse.data);

	const subscriberStatus = countBy(subscribers, (subscriber) =>
		String(subscriber.status || "unknown").toLowerCase(),
	);

	const runningCampaigns = campaigns.filter((campaign) =>
		["running", "scheduled"].includes(
			String(campaign.status || "").toLowerCase(),
		),
	);

	const campaignsCreatedInWindow = campaigns.filter((campaign) => {
		const createdAt = toDate(campaign.created_at);
		return createdAt ? createdAt >= from : false;
	});

	const bouncesInWindow = bounces.filter((bounce) => {
		const createdAt =
			typeof bounce.created_at === "string"
				? toDate(bounce.created_at)
				: undefined;
		return createdAt ? createdAt >= from : false;
	}).length;

	const sent = campaigns.reduce(
		(sum, campaign) => sum + Math.max(0, Number(campaign.sent || 0)),
		0,
	);
	const views = campaigns.reduce(
		(sum, campaign) => sum + Math.max(0, Number(campaign.views || 0)),
		0,
	);
	const clicks = campaigns.reduce(
		(sum, campaign) => sum + Math.max(0, Number(campaign.clicks || 0)),
		0,
	);

	const campaignBreaches: DailyDigestResult["risk"]["campaignBreaches"] = [];
	for (const campaign of runningCampaigns.slice(0, 10)) {
		const campaignId = toPositiveInt(campaign.id);
		if (!campaignId) {
			continue;
		}
		const guardResult = await evaluateDeliverabilityGuard(client, campaignId, {
			bounceThreshold: options.bounceThreshold,
			openRateThreshold: options.openRateThreshold,
			clickRateThreshold: options.clickRateThreshold,
			pauseOnBreach: false,
		});
		if (guardResult.breaches.length > 0) {
			campaignBreaches.push({
				campaignId,
				campaignName: guardResult.campaignName,
				breaches: guardResult.breaches,
			});
		}
	}

	const markdownLines = [
		"# Listmonk Ops Daily Digest",
		`- Generated: ${now.toISOString()}`,
		`- Window: last ${hours}h (${from.toISOString()} ~ ${now.toISOString()})`,
		"",
		"## KPI Snapshot",
		`- Lists: ${lists.length.toLocaleString()}`,
		`- Subscribers: ${subscribers.length.toLocaleString()}`,
		`- Campaigns: ${campaigns.length.toLocaleString()} (running/scheduled: ${runningCampaigns.length.toLocaleString()})`,
		`- Campaigns created in window: ${campaignsCreatedInWindow.length.toLocaleString()}`,
		`- Sent: ${sent.toLocaleString()}, Views: ${views.toLocaleString()}, Clicks: ${clicks.toLocaleString()}`,
		`- Bounces in window: ${bouncesInWindow.toLocaleString()}`,
		"",
		"## Subscriber Status",
		...Object.entries(subscriberStatus).map(
			([status, count]) => `- ${status}: ${count.toLocaleString()}`,
		),
		"",
		"## Risk Alerts",
		...(campaignBreaches.length > 0
			? campaignBreaches.map(
					(entry) =>
						`- Campaign ${entry.campaignId} (${entry.campaignName}): ${entry.breaches.join("; ")}`,
				)
			: ["- No active deliverability breaches detected"]),
	];

	return {
		generatedAt: now.toISOString(),
		window: {
			hours,
			from: from.toISOString(),
			to: now.toISOString(),
		},
		metrics: {
			lists: lists.length,
			subscribers: subscribers.length,
			subscriberStatus,
			campaigns: campaigns.length,
			runningCampaigns: runningCampaigns.length,
			campaignsCreatedInWindow: campaignsCreatedInWindow.length,
			sent,
			views,
			clicks,
			bouncesInWindow,
		},
		risk: {
			campaignBreaches,
		},
		markdown: markdownLines.join("\n"),
	};
}
