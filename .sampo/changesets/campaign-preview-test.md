---
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/openapi: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/cli: minor
---

Added `campaigns.preview` and `campaigns.test` (experimental, 108 → 110 total descriptors). `campaigns.preview` renders the stored campaign body to HTML exactly as recipients would see it (a read; the GET endpoint answers with the rendered document rather than a JSON envelope). `campaigns.test` delivers the campaign to 1–10 existing-subscriber emails: the observed Listmonk 6.2 test endpoint rebinds the entire campaign form from the request and requires the recipients under an undocumented `subscribers` key, so the executor derives the form from the stored campaign and overlays explicit caller overrides (subject, template, body, messenger, from address), with unknown recipients rejected remotely and client-side email validation before any request. The test send follows the transactional-send convention — a real single-recipient delivery without a destructive confirmation gate, with retry honestly classified unsafe because every run re-sends. The legacy hand-rolled `listmonk_test_campaign` MCP tool (which took `emails`) is converted to the shared operation under the same name with structured content; the OpenAPI `CampaignTestParams` boundary now layers the observed `subscribers` field instead of distorting generated types. CLI: `listmonk-cli campaigns preview --id N` and `campaigns test --id N --subscribers a@b.c`.
