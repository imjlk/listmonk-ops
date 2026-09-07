---
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/openapi: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/cli: minor
---

Added three stable operations (124 → 127 total descriptors) covering the last unused SDK maintenance surface. `maintenance.gc-subscribers` one-shot deletes every orphaned or blocklisted subscriber; `maintenance.gc-unconfirmed` one-shot deletes every subscription unconfirmed before an RFC3339 cutoff — both confirmation-gated destructive collections whose spec states honestly that the server offers **no preview** (one confirmed request deletes the full matching set) and whose retry semantics reconcile: a repeated identical request reports `count: 0` once the set is empty. The unconfirmed cutoff's wire format was corrected in the owned overlay: the upstream spec models it as a form body while the observed 6.2 endpoint takes it as a query parameter, and the RFC3339 pattern is shared between the Zod schema and the published Typia contract through a leaf module. `system.reload` refreshes the app configuration without a restart — a repeatable non-destructive maintenance write replacing the legacy hand-rolled `listmonk_reload_app` tool. CLI: `listmonk-cli maintenance gc-subscribers|gc-unconfirmed` and `system reload`; MCP: `listmonk_gc_subscribers`, `listmonk_gc_unconfirmed_subscriptions`, `listmonk_reload_app`.
