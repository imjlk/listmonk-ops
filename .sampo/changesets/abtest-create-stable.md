---
npm/@listmonk-ops/abtest: minor
npm/@listmonk-ops/operations: minor
---

Promote `abtest.create` from experimental to stable by closing the remaining crash windows. The deterministic assignment seed is checkpointed before any segmentation list is created, so a retry re-splits identically; audience lists tagged `abtest:`/`abtest-role:`/`abtest-variant:` by a prior crashed attempt are adopted instead of re-created (membership re-sync is idempotent under the persisted seed, and ambiguous duplicate-tag lists fail explicitly); the auto-launch window is stamped before remote scheduling; and rollback clears mappings only for confirmed deletions. Combined with the phase checkpoints and tag-based campaign reconciliation from the previous batch, an identical keyed retry now converges on the same test. The stable TypeScript contract count rises from 82 to 83.
