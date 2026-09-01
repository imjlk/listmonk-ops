---
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/openapi: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/cli: minor
---

Added `campaigns.analytics` (experimental, 110 → 111 total descriptors): a read over Listmonk's campaign analytics facets (`views`, `clicks`, `links`, `bounces`) for 1–20 campaigns over an ISO calendar-date range. The observed endpoint answers views/clicks/bounces with daily `{campaign_id, count, timestamp}` buckets and links with `{url, count}` aggregates — normalized only at the envelope — and accepts campaign ids exclusively as repeated `id` query parameters (a comma-joined value is rejected), now encoded at the OpenAPI boundary (`CampaignOperations.getAnalytics` takes `id: string[]`). CLI: `listmonk-cli campaigns analytics --type views --from ... --to ... --campaign-ids 1,2`. The ISO date pattern and id cap are shared leaf modules referenced by both the Zod schema and the published Typia contract; the spec verb vocabulary gains `analytics`.
