---
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/cli: minor
---

Added `bounces.delete` (experimental, 106 → 107 total descriptors): a confirmed single-record delete whose retry is a documented no-op — Listmonk 6.2 acknowledges an already-deleted bounce ID with the same bare success, so the operation reports the acknowledgement and directs verification through `bounces.list`. The CLI gains `listmonk-cli bounces delete --id N --confirm`, and the MCP tool `listmonk_delete_bounce` keeps its legacy name while now projecting the shared operation with structured content and the MCP-only `confirm` input. The bulk `listmonk_delete_bounces` tool (explicit ids or `all=true`) deliberately remains transport-specific: the observed bulk endpoint rejects any request naming a missing ID with `400 Invalid ID(s)` and deletes nothing, so its retry contract needs a dedicated echo design before joining the shared catalog.
