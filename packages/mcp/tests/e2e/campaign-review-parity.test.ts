import { describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { buildCampaignReview } from "@listmonk-ops/automation";
type CampaignReviewResult = Awaited<ReturnType<typeof buildCampaignReview>>;
import { createMCPTestSuite } from "../mcp-helper.js";
import { buildTestName, createTestClient, TEST_CONFIG } from "../setup.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
describe("campaign review real-stack CLI/MCP parity without delivery", () => {
 const { client, utils } = createMCPTestSuite();
 test("both adapters collect actual preview, template and list evidence without changing the draft", async () => {
  const api = createTestClient();
  const prefix = buildTestName("campaign-review-parity");
  let listId: number | undefined;
		let templateId: number | undefined;
		let campaignId: number | undefined;
  try {
   const list = await api.list.create({ body: { name: prefix, type: "private", optin: "single" } });
   if (list.error || !list.data.id) throw new Error("Review list fixture creation failed");
   listId = list.data.id;
   const template = utils.assertSuccess<{ template: { id: number } }>(await client.callTool("listmonk_create_template", {
    name: prefix, type: "campaign", subject: prefix,
    body: '<html><body><h1>Review wrapper</h1>{{ template "content" . }}</body></html>',
   }));
   templateId = template.template.id;
   const created = await api.campaign.create({ body: {
    name: prefix, subject: "Review parity", from_email: "review@example.test", lists: [listId],
    content_type: "html", template_id: templateId, messenger: "email", type: "regular",
    body: "<p>Read-only review evidence https://example.test unsubscribe</p>",
   } });
   if (created.error || !created.data.id) throw new Error("Review campaign fixture creation failed");
   campaignId = created.data.id;
   const before = await api.campaign.getById({ path: { id: campaignId } });
   const mcp = utils.assertSuccess<CampaignReviewResult>(await client.callTool("listmonk_ops_campaign_review", { campaign_id: campaignId }));
   const cli = Bun.spawnSync(["bun", resolve(root, "apps/cli/src/index.ts"), "ops", "--format", "json", "campaign-review", "--campaign-id", String(campaignId)], {
    cwd: resolve(root, "apps/cli"), env: { ...process.env, BUN_FORCE_COLOR: "0", LISTMONK_API_URL: TEST_CONFIG.baseUrl,
     LISTMONK_USERNAME: TEST_CONFIG.username, LISTMONK_API_TOKEN: TEST_CONFIG.apiToken || TEST_CONFIG.password }, stdout: "pipe", stderr: "pipe",
   });
   expect(cli.exitCode).toBe(0);
   const cliReport = JSON.parse(cli.stdout.toString()) as CampaignReviewResult;
   for (const result of [mcp, cliReport]) {
    expect(result.snapshot.campaign_id).toBe(campaignId);
    expect(result.snapshot.fields).toMatchObject({ name: prefix, subject: "Review parity", status: "draft", template_id: templateId });
    expect(result.snapshot.fields.template_body_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.snapshot.lists).toEqual([{ id: listId, name: prefix, subscriber_count: 0 }]);
    expect(result.preview.html).toContain("Review wrapper");
    expect(result.preview.html).toContain("Read-only review evidence");
    expect(result.preview.trusted).toBe(false);
   }
   // Preview render substitutions may be volatile; compare stable contract evidence only.
   const { preview_sha256: _mcpPreview, ...mcpFields } = mcp.snapshot.fields;
   const { preview_sha256: _cliPreview, ...cliFields } = cliReport.snapshot.fields;
   expect(cliFields).toEqual(mcpFields);
   expect(cliReport.snapshot.campaign_uuid).toBe(mcp.snapshot.campaign_uuid);
   expect(cliReport.snapshot.lists).toEqual(mcp.snapshot.lists);
   expect(cliReport.preflight).toEqual(mcp.preflight);
   expect(cliReport.comparison).toEqual(mcp.comparison);
   const after = await api.campaign.getById({ path: { id: campaignId } });
   expect(after.data).toEqual(before.data);
  } finally {
   if (campaignId !== undefined) await api.campaign.delete({ path: { id: campaignId } });
   if (templateId !== undefined) await api.template.delete({ path: { id: templateId } });
   if (listId !== undefined) await api.list.delete({ path: { list_id: listId } });
  }
 });
});
