---
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/openapi: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/cli: minor
---

Added the first shared bounce operations: `bounces.list` and `bounces.get` (experimental, 104 → 106 total descriptors). Bounce reads normalize the observed Listmonk 6.2 `/api/bounces` envelope (server-side `page`/`per_page` plus `campaign_id`, `source`, `order_by`, and `order` filters) into the shared page contract, and the single-bounce read tolerates both the observed flat record and the upstream OpenAPI document's collection-shaped response at the handwritten boundary instead of distorting generated types. The CLI gains `listmonk-cli bounces list|get`, and the MCP read tools `listmonk_get_bounces`/`listmonk_get_bounce` keep their legacy names while now projecting the shared operations with structured content. The legacy `subscriber_id` filter argument was dropped because Listmonk has no such query parameter on `/api/bounces` and it never reached the API; the destructive `listmonk_delete_bounce`/`listmonk_delete_bounces` tools remain transport-specific until their shared operations land. The flattened, exported `BounceOperations` client interface surfaces its methods as compiler-graph nodes so the shared read paths are architecture-checked end to end.
