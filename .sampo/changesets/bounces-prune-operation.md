---
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/cli: minor
---

Added `bounces.prune` (experimental, 107 → 108 total descriptors), replacing the legacy ungated bulk `listmonk_delete_bounces` MCP tool (explicit ids or `all=true`) with a preview-then-echo contract modeled on `webhooks.prune`. A dry run reports the exact bounce ids of its bounded selection window (at most 100, with the shared campaign/source/ordering filters); the destructive run echoes that set as `bounce_ids` and is confirmation-gated even in preview. Because the observed Listmonk 6.2 bulk endpoint rejects any request naming a missing id with `400 Invalid ID(s)` and deletes nothing, the destructive run is issued as per-id deletes whose missing-id acknowledgement is the same bare success — so an echoed repeat deletes nothing new (retry classified safe with `bounces.list` verification). The CLI gains `listmonk-cli bounces prune [--filters]` and `bounces prune --no-dry-run --bounce-ids ... --confirm`; acknowledgements are documented as not being existence proofs.
