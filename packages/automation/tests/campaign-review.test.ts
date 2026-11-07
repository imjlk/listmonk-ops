import { describe, expect, test } from "bun:test";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	buildCampaignReview,
	campaignReviewInputSchema,
	campaignReviewSnapshotSchema,
	compareCampaignReviewSnapshots,
} from "../src/campaign-review";
import {
	campaignReviewOperation,
	invokeCampaignReviewOperation,
	invokeOpsOperationByMcpName,
} from "../src/ops-operations";

function fixture(overrides: Record<string, unknown> = {}) {
	const campaign = {
		id: 42,
		uuid: "campaign-uuid",
		name: "Welcome",
		subject: "Hello",
		from_email: "News <news@example.test>",
		updated_at: "2026-01-01T00:00:00Z",
		status: "draft",
		body: "Body",
		lists: [{ id: 7 }],
		template_id: 3,
		...overrides,
	};
	const calls: string[] = [];
	const client = {
	 campaign: {
		 getById: async () => {
			 calls.push("campaign.get");
			 return { data: structuredClone(campaign) };
		 },
		 preview: async () => {
			 calls.push("campaign.preview");
			 return {
				 data: '<p>Preview</p><a href="https://newsletter.test/subscription/00000000-0000-0000-0000-000000000000/00000000-0000-0000-0000-000000000000">Leave</a>',
			 };
		 },
	 },
	 list: {
		 getById: async () => {
			 calls.push("list.get");
			 return {
				 data: {
					 id: 7,
					 name: "Audience",
					 subscriber_count: 10,
					 secret: "not exported",
				 },
			 };
		 },
	 },
	 template: {
		 getById: async () => {
			 calls.push("template.get");
			 return { data: { id: 3, body: "Template", updated_at: "template-r1" } };
		 },
	 },
 };
	return { campaign, calls, client: client as unknown as ListmonkClient };
}
const input = campaignReviewInputSchema.parse({ campaign_id: 42 });

describe("campaign review package", () => {
	test("captures the same preview as preflight with read-only bounded calls and no mutation", async () => {
		const { campaign, client, calls } = fixture();
		const before = structuredClone(campaign);
		const result = await buildCampaignReview(client, input);
		expect(calls).toEqual([
			"campaign.get",
			"list.get",
			"campaign.preview",
			"template.get",
			"campaign.get",
		]);
		expect(campaign).toEqual(before);
		expect(result.snapshot.fields.template_updated_at).toBe("template-r1");
		expect(result.snapshot.fields.body_sha256).toHaveLength(64);
		expect(result.snapshot.lists).toEqual([
			{ id: 7, name: "Audience", subscriber_count: 10 },
		]);
		expect(result.preflight.audienceEstimate).toBe(10);
		expect(result.preflight.checks.find((check) => check.id === "unsubscribe_link")?.level).toBe(
			"pass",
		);
		expect(result.comparison.compared).toBe(false);
		expect(JSON.stringify(result)).not.toContain("not exported");
		expect(campaignReviewOperation.safety.readOnlyHint).toBe(true);
	});
	test("compares content, sender, schedule, audience, template and rendered changes with readable field labels", async () => {
		const { client } = fixture();
		const first = (await buildCampaignReview(client, input)).snapshot;
		const next = structuredClone(first);
		next.fields.subject = "New subject";
		next.fields.from_email = "new@example.test";
		next.fields.send_at = "2026-02-01T00:00:00Z";
		next.fields.body_sha256 = "a".repeat(64);
		next.fields.preview_sha256 = "b".repeat(64);
		next.fields.template_body_sha256 = "c".repeat(64);
		next.lists[0]!.subscriber_count = 11;
		const comparison = compareCampaignReviewSnapshots(first, next);
		expect(comparison.changed_fields).toEqual([
			"subject",
			"from_email",
			"send_at",
			"template_body_sha256",
			"body_sha256",
			"preview_sha256",
			"lists",
		]);
		expect(comparison.messages).toContain("Changed: subject");
		expect(compareCampaignReviewSnapshots(first, structuredClone(first)).changed_fields).toEqual(
			[],
		);
	});
	test("rejects mismatched identity and unknown comparison identity", async () => {
		const snapshot = (await buildCampaignReview(fixture().client, input)).snapshot;
		for (const different of [{ ...snapshot, campaign_id: 43 }, { ...snapshot, campaign_uuid: "other" }, { ...snapshot, campaign_uuid: null }]) {
			expect(() => compareCampaignReviewSnapshots(different, snapshot)).toThrow(
				"identity",
			);
		}
	});
	test("keeps incomplete metadata unknown and does not invent template or schedule references", async () => {
		const result = await buildCampaignReview(fixture({ template_id: undefined, from_email: undefined, send_at: undefined, uuid: undefined, altbody: undefined }).client, input);
		expect(result.snapshot.campaign_uuid).toBeNull();
		expect(result.snapshot.fields).toMatchObject({
			template_id: null,
			template_updated_at: null,
			template_body_sha256: null,
			from_email: null,
			send_at: null,
			altbody_sha256: null,
		});
		expect(result.limitations.join(" ")).toContain("not deduplicated");
	});
	test("missing revision and concurrent edits fail closed", async () => {
		await expect(buildCampaignReview(fixture({ updated_at: undefined }).client, input)).rejects.toThrow("missing updated_at");
		for (const field of ["updated_at", "uuid"] as const) {
			const { client, campaign } = fixture();
			const original = client.campaign.preview;
			client.campaign.preview = async (...args) => { const response = await original(...args); campaign[field] = "new"; return response; };
			await expect(buildCampaignReview(client, input)).rejects.toThrow("changed while collecting");
		}
	});
	test("revision transport and envelope failures use one sanitized label", async () => {
		for (const failure of ["envelope", "transport"] as const) {
			const { client } = fixture();
			const original = client.campaign.getById;
			let reads = 0;
			client.campaign.getById = async (...args) => {
				if (++reads === 1) return original(...args);
				if (failure === "transport") throw new Error("credential-secret");
				return ({ error: { message: "credential-secret" } }) as never;
			};
			await expect(buildCampaignReview(client, input)).rejects.toThrow(/^Campaign review could not read campaign revision; verify permissions and retry$/);
		}
	});
	test("bounds lists before fan-out and rejects invalid snapshots", async () => {
		const { client, calls } = fixture({
			lists: Array.from({ length: 101 }, (_, index) => ({ id: index + 1 })),
		});
		await expect(buildCampaignReview(client, input)).rejects.toThrow("100 target lists");
		expect(calls).toEqual(["campaign.get"]);
		expect(() => campaignReviewSnapshotSchema.parse({ version: 2 })).toThrow();
		const snapshot = (await buildCampaignReview(fixture().client, input)).snapshot;
		expect(() => campaignReviewSnapshotSchema.parse({ ...snapshot, fields: { ...snapshot.fields, subject: "x".repeat(513) } })).toThrow();
	});
	test("preview failures are fail findings, never transport detail leaks", async () => {
		const { client } = fixture();
		client.campaign.preview = async () => { throw new Error("secret-preview-token"); };
		client.template.getById = async () => { throw new Error("secret-template-token"); };
		const result = await buildCampaignReview(client, input);
		expect(result.preview).toEqual({ html: null, trusted: false });
		expect(result.snapshot.fields.preview_sha256).toBeNull();
		expect(result.preflight.summary.fail).toBeGreaterThan(0);
		expect(JSON.stringify(result)).not.toContain("secret-");
	});
	test("oversized or empty previews are unavailable and remain fail findings", async () => {
		for (const rendered of ["", "x".repeat(2_000_001)]) {
			const { client } = fixture();
			client.campaign.preview = async () => ({ data: rendered });
			const result = await buildCampaignReview(client, input);
			expect(result.preview.html).toBeNull();
			expect(result.preflight.summary.fail).toBeGreaterThan(0);
		}
	});
	test("remote campaign failures are sanitized", async () => {
		const { client } = fixture();
		client.campaign.getById = async () => { throw new Error("credential-secret"); };
		await expect(buildCampaignReview(client, input)).rejects.toThrow("could not read campaign");
		try {
			await buildCampaignReview(client, input);
		} catch (error) {
			expect(String(error)).not.toContain("credential-secret");
		}
	});
	test("CLI invoker and MCP dispatch share a deterministic contract and previous snapshot validation", async () => {
		const cli = await invokeCampaignReviewOperation({ client: fixture().client }, { campaign_id: 42 });
		const mcp = await invokeOpsOperationByMcpName({ client: fixture().client }, "listmonk_ops_campaign_review", { campaign_id: 42 });
		expect(mcp?.output).toEqual(cli);
		const compared = await invokeCampaignReviewOperation({ client: fixture().client }, { campaign_id: 42, previous_snapshot: cli.snapshot });
		expect(compared.comparison).toEqual({
			compared: true,
			changed_fields: [],
			messages: [],
		});
		await expect(invokeCampaignReviewOperation({ client: fixture().client }, { campaign_id: 42, previous_snapshot: { version: 99 } })).rejects.toThrow();
	});
	test("raw HTML remains an explicitly untrusted JSON string, never an active HTML report", async () => {
		const { client } = fixture();
		const malicious = '<script>alert("x")</script><img src="https://tracker.test/pixel">';
		client.campaign.preview = async () => ({ data: malicious });
		const result = await buildCampaignReview(client, input);
		expect(result.preview.trusted).toBe(false);
		expect(JSON.parse(JSON.stringify(result)).preview.html).toBe(malicious);
		expect(result.limitations.join(" ")).toContain(
			"never insert into an active HTML page",
		);
	});
	test("unknown list counts warn and mismatched templates are not recorded as evidence", async () => {
		const { client } = fixture();
		client.list.getById = async () => ({ data: { id: 7, subscriber_count: undefined } }) as Awaited<ReturnType<typeof client.list.getById>>;
		client.template.getById = async () => ({ data: { id: 999, body: "Wrong template" } }) as Awaited<ReturnType<typeof client.template.getById>>;
		const result = await buildCampaignReview(client, input);
		expect(result.snapshot.lists[0]!.subscriber_count).toBeNull();
		expect(result.preflight.checks).toContainEqual({
			id: "review_audience_incomplete",
			level: "warn",
			message: "Some list counts are unknown; audience estimate includes only known counts",
		});
		expect(result.preflight.checks.find((check) => check.id === "template_reference")?.level).toBe(
			"fail",
		);
		expect(result.snapshot.fields.template_body_sha256).toBeNull();
	});
	test("target list ordering and duplicate references do not alter the captured audience", async () => {
		const { client } = fixture({ lists: [{ id: 7 }, { id: 7 }] });
		const result = await buildCampaignReview(client, input);
		expect(result.snapshot.lists).toHaveLength(1);
		expect(result.preflight.audienceEstimate).toBe(10);
	});
});
