---
npm/@listmonk-ops/operations: minor
---

Promote 7 safe-retry mutation operations from experimental to stable: lists.update, subscribers.update, campaigns.update, campaigns.pause (no-op when already paused), subscribers.add-to-lists, subscribers.unblocklist, and ops.templates.registry-sync (idempotent for unchanged templates). All seven use standalone TypeScript contracts with safe retry and reversible-write effects. The stable TypeScript contract count rises from 55 to 62.
