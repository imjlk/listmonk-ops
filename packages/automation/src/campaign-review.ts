import { createHash } from "node:crypto";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import { z } from "zod";
import { runCampaignPreflight, type CampaignPreflightClient } from "./campaign";
import { MAX_RENDERED_CAMPAIGN_CHARACTERS } from "./campaign-content";
import { unwrapResponseData } from "./api";

export const MAX_REVIEW_LISTS = 100;
const text = z.string().max(512).nullable();
const digest = z.string().regex(/^[a-f0-9]{64}$/).nullable();
const id = z.number().int().positive();
export const campaignReviewSnapshotSchema = z.object({
	version: z.literal(1),
	campaign_id: id,
	campaign_uuid: text,
	fields: z.object({
		name: text,
		subject: text,
		from_email: text,
		status: text,
		send_at: text,
		updated_at: text,
		content_type: text,
		messenger: text,
		template_id: id.nullable(),
		template_updated_at: text,
		template_body_sha256: digest,
		body_sha256: digest,
		altbody_sha256: digest,
		preview_sha256: digest,
	}),
	lists: z.array(z.object({ id, name: text, subscriber_count: z.number().int().nonnegative().nullable() })).max(
		MAX_REVIEW_LISTS,
	),
});
export const campaignReviewInputSchema = z.object({
	campaign_id: id,
	max_audience: z.number().int().positive().default(200_000),
	previous_snapshot: campaignReviewSnapshotSchema.optional(),
});
export const campaignReviewOutputSchema = z.object({
	snapshot: campaignReviewSnapshotSchema,
	preview: z.object({
		html: z.string().max(MAX_RENDERED_CAMPAIGN_CHARACTERS).nullable(),
		trusted: z.literal(false),
	}),
	preflight: z.object({
		checks: z.array(
			z.object({
				id: z.string(),
				level: z.enum(["pass", "warn", "fail"]),
				message: z.string(),
			}),
		),
		summary: z.object({ pass: z.number(), warn: z.number(), fail: z.number() }),
		audienceEstimate: z.number(),
	}),
	comparison: z.object({
		compared: z.boolean(),
		changed_fields: z.array(z.string()),
		messages: z.array(z.string()),
	}),
	limitations: z.array(z.string()),
});
export type CampaignReviewSnapshot = z.output<typeof campaignReviewSnapshotSchema>;

function hash(value: unknown): string | null {
	if (typeof value !== "string") return null;
	if (value.length > MAX_RENDERED_CAMPAIGN_CHARACTERS) throw new Error("Campaign review content exceeds the size limit");
	return createHash("sha256").update(value).digest("hex");
}
function boundedText(value: unknown): string | null {
	return typeof value === "string" && value.length <= 512 ? value : null;
}

export function compareCampaignReviewSnapshots(previous: CampaignReviewSnapshot | undefined, current: CampaignReviewSnapshot) {
	if (!previous) return { compared: false, changed_fields: [], messages: [] };
 // A numeric id alone is not an immutable identity across instances.
	if (!previous.campaign_uuid || previous.campaign_id !== current.campaign_id || previous.campaign_uuid !== current.campaign_uuid) {
		throw new Error(
			"Review snapshot identity mismatch or missing campaign UUID",
		);
	}
	const changed: string[] = [];
	for (const key of Object.keys(
		current.fields,
	) as Array<keyof CampaignReviewSnapshot["fields"]>) {
		if (previous.fields[key] !== current.fields[key]) changed.push(key);
	}
	if (JSON.stringify(previous.lists) !== JSON.stringify(current.lists)) changed.push("lists");
	return {
		compared: true,
		changed_fields: changed,
		messages: changed.map((field) => `Changed: ${field}`),
	};
}

async function readReview<T>(read: () => Promise<T>, label: string): Promise<T> {
	try {
		return await read();
	} catch {
		throw new Error(
			`Campaign review could not read ${label}; verify permissions and retry`,
		);
	}
}
function reviewData<T>(response: Parameters<typeof unwrapResponseData<T>>[0], label: string): T {
	try {
		return unwrapResponseData(response, label);
	} catch {
		throw new Error(
			`Campaign review could not read ${label}; verify permissions and retry`,
		);
	}
}

/** Read-only capture. No subscriber enumeration, link requests, local registry writes or sends. */
export async function buildCampaignReview(client: CampaignPreflightClient, input: z.output<typeof campaignReviewInputSchema>) {
	const campaignResponse = await readReview(
		() => client.campaign.getById({ path: { id: input.campaign_id } }),
		"campaign",
	);
	const campaign = reviewData(campaignResponse, "campaign");
	if (campaign.id !== input.campaign_id) throw new Error("Campaign review identity mismatch");
	const entries = campaign.lists ?? [];
	if (entries.length > MAX_REVIEW_LISTS) throw new Error("Campaign review supports at most 100 target lists");
	const listIds = [...new Set(entries.map((entry) => id.parse(entry.id)))].sort(
		(a, b) => a - b,
	);
	const lists: CampaignReviewSnapshot["lists"] = [];
	const listResponses = new Map<number, Awaited<ReturnType<ListmonkClient["list"]["getById"]>>>();
	for (const listId of listIds) {
		const response = await readReview(
			() => client.list.getById({ path: { list_id: listId } }),
			"target list",
		);
		const list = reviewData(response, "target list");
		if (list.id !== listId) throw new Error("Campaign review list identity mismatch");
		listResponses.set(listId, {
		...response,
		data: {
			...list,
			subscriber_count: typeof list.subscriber_count === "number" && Number.isSafeInteger(list.subscriber_count) && list.subscriber_count >= 0
				? list.subscriber_count
				: 0,
		},
	});
		lists.push({
		id: listId,
		name: boundedText(list.name),
		subscriber_count: typeof list.subscriber_count === "number" && Number.isSafeInteger(list.subscriber_count) && list.subscriber_count >= 0
			? list.subscriber_count
			: null,
	});
	}
	// Reuse exactly the captured reads in preflight. No mutation endpoint exists on this facade.
	let templateResponse: Awaited<ReturnType<ListmonkClient["template"]["getById"]>> | undefined;
	let html: string | null = null;
	const readClient: CampaignPreflightClient = {
  campaign: {
   getById: async () => ({ ...campaignResponse, data: {
    ...campaign,
    status: boundedText(campaign.status) ?? undefined,
    lists: listIds.map((listId) => ({ id: listId })),
   } }),
   preview: async () => {
    const response = await readReview(
     () => client.campaign.preview({ path: { id: input.campaign_id } }),
     "preview",
    );
    const rendered = reviewData(response, "preview");
    if (typeof rendered === "string" && rendered.trim() && rendered.length <= MAX_RENDERED_CAMPAIGN_CHARACTERS) {
     html = rendered;
    }
    return response;
   },
  },
  list: {
   getById: async ({ path }) => listResponses.get(path.list_id)!,
  },
  template: {
   getById: async () => {
    const response = await readReview(
     () => client.template.getById({ path: { id: campaign.template_id! } }),
     "template",
    );
    const template = reviewData(response, "template");
    if (template.id !== campaign.template_id) throw new Error("Campaign review template identity mismatch");
    templateResponse = response;
    return response;
   },
  },
 };
	const preflight = await runCampaignPreflight(readClient, input.campaign_id, {
		maxAudience: input.max_audience,
		checkLinks: false,
	});
	const template = templateResponse && "data" in templateResponse
		? templateResponse.data
		: undefined;
	if (lists.some((list) => list.subscriber_count === null)) {
		preflight.checks.push({
		id: "review_audience_incomplete",
		level: "warn",
		message: "Some list counts are unknown; audience estimate includes only known counts",
	});
		preflight.summary.warn += 1;
	}
	const snapshot = campaignReviewSnapshotSchema.parse({
	 version: 1,
	 campaign_id: input.campaign_id,
	 campaign_uuid: boundedText(campaign.uuid),
	 fields: {
		 name: boundedText(campaign.name),
		 subject: boundedText(campaign.subject),
		 from_email: boundedText(campaign.from_email),
		 status: boundedText(campaign.status),
		 send_at: boundedText(campaign.send_at),
		 updated_at: boundedText(campaign.updated_at),
		 content_type: boundedText(campaign.content_type),
		 messenger: boundedText(campaign.messenger),
		 template_id: typeof campaign.template_id === "number" && campaign.template_id > 0
			 ? campaign.template_id
			 : null,
		 template_updated_at: boundedText(template?.updated_at),
		 template_body_sha256: hash(template?.body),
		 body_sha256: hash(campaign.body),
		 altbody_sha256: hash(campaign.altbody),
		 preview_sha256: hash(html),
	 },
	 lists,
 });
	const current = reviewData(
	 await readReview(() => client.campaign.getById({ path: { id: input.campaign_id } }), "campaign"),
	 "Campaign review could not verify revision",
 );
	if (current.id !== campaign.id || current.uuid !== campaign.uuid || current.updated_at !== campaign.updated_at) throw new Error("Campaign changed while collecting review; collect a new review");
	return {
  snapshot, preview: { html, trusted: false as const },
  preflight: {
   checks: preflight.checks.map(({ id, level, message }) => ({ id, level, message })),
   summary: preflight.summary, audienceEstimate: preflight.audienceEstimate,
  },
  comparison: compareCampaignReviewSnapshots(input.previous_snapshot, snapshot),
  limitations: [
   "Read-only evidence, not approval or an atomic send guarantee. Re-run before a separately approved send.",
   "Use snapshot.fields.updated_at with the existing expected_updated_at start/schedule guard; that guard is not atomic and does not pin list membership or templates.",
   "Audience is the sum of list subscriber counts, not deduplicated or filtered deliverable recipients; no subscriber records are exported.",
   "Campaign, lists, template and preview are separate reads. Template and audience can change independently of campaign updated_at.",
   "Missing or oversized metadata is null (unknown), not evidence of absence. No template registry revision is invented.",
   "Preview HTML is untrusted and may contain personalized data or tracking URLs. Store privately; never insert into an active HTML page without isolation.",
   "Preview uses Listmonk's preview subscriber, not every recipient. Link checks are disabled.",
  ],
 };
}
