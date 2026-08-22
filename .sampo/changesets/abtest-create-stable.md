---
npm/@listmonk-ops/abtest: minor
npm/@listmonk-ops/operations: minor
---

Promote `abtest.create` from experimental to stable with testing-mode-conditional retry semantics. Holdout creates are retry-safe end to end: the deterministic assignment seed and auto-launch window are checkpointed before their remote effects, campaigns and audience lists tagged `abtest:` by a prior crashed attempt are adopted instead of re-created, adopted-list membership is reconciled to the exact expected member set (stale crashed-attempt members removed, missing added), duplicate holdout/variant tags fail explicitly, the list lookup is scoped server-side by the tag, and rollback clears mappings only for confirmed deletions — an identical retry converges on the same test. Full-split creates keep the legacy random shuffle and stay honestly unsafe. The stable TypeScript contract count rises from 82 to 83.
