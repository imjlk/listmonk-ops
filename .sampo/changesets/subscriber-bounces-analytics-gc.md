---
npm/@listmonk-ops/openapi: minor
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/cli: minor
---

Added three shared operations (stable, 128 → 131 total descriptors): `subscribers.bounces.get` reads one subscriber's bounce history (an unknown subscriber answers with an empty collection, not an error), `subscribers.bounces.delete` clears that history in one confirmation-gated request whose boolean acknowledgement is not an existence proof, and `maintenance.gc-analytics` one-shot deletes campaign analytics (`all`/`views`/`clicks`) recorded before an RFC3339 cutoff across every campaign — no server-side preview or count exists, so the gate and the no-preview boundary are stated in the spec. Verified against the observed 6.2 endpoint, which takes the analytics cutoff as a query parameter because echo does not parse form bodies on DELETE; the owned overlay now models that query parameter (and the `all|views|clicks` enum) instead of the upstream form body, and the generated SDK was regenerated. CLI: `listmonk-cli bounces subscriber --subscriber-id 7`, `listmonk-cli bounces delete-subscriber --subscriber-id 7 --confirm`, and `listmonk-cli maintenance gc-analytics --type views --before-date 2026-01-01T00:00:00Z --confirm`; the MCP tools `listmonk_get_subscriber_bounces`, `listmonk_delete_subscriber_bounces`, and `listmonk_gc_analytics` join the shared catalog. The stable baseline was re-accepted (131 contracts).
