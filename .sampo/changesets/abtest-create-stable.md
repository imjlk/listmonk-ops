---
npm/@listmonk-ops/abtest: minor
npm/@listmonk-ops/operations: minor
---

Promote `abtest.create` from experimental to stable with testing-mode- and auto-launch-conditional retry semantics. Non-launching holdout creates are retry-safe end to end: the deterministic assignment seed is checkpointed before any segmentation list exists, campaigns and audience lists tagged `abtest:` by a prior crashed attempt are adopted instead of re-created, adopted-list membership is reconciled to the exact expected member set (stale crashed-attempt members removed with validated responses, missing members added), and malformed tags — duplicate holdout lists, multiple variant tags on one list, a list shared across variants, or campaigns tagged for two variants — fail explicitly. Auto-launching creates stay unsafe (sequential campaign scheduling can deliver before a retry) and full-split creates keep the legacy random shuffle as an explicitly unsafe branch; `idempotentHint` stays false. The stable TypeScript contract count rises from 82 to 83.
