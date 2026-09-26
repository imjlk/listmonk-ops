---
npm/@listmonk-ops/operations: minor (Added)
npm/@listmonk-ops/mcp: minor (Added)
npm/@listmonk-ops/cli: minor (Added)
---

Added the stable `subscribers.unsubscribe-from-lists` operation (135 → 136 described operations). It sends Listmonk's `unsubscribe` list action, which keeps each membership with the status `unsubscribed` instead of deleting it, so the opt-out record survives: list campaigns skip those subscribers and a later add without an explicit status or a non-overwriting import does not resubscribe them. It is a confirmed, audited, previewable suppression with the shared bulk options (`dry_run`, `max_items`, `continue_on_error`). CLI: `listmonk-cli subscribers unsubscribe-from-lists --subscriber-ids 1,2 --list-ids 10 --confirm`; MCP: `listmonk_unsubscribe_subscribers_from_lists`. The CLI pack-size budget gains the same headroom as the subscriber write fixes.
