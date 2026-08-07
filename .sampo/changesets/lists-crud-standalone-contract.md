---
npm/@listmonk-ops/operations: minor
---

Migrate `lists.create`, `lists.update`, and `lists.delete` from runtime-operation bridge snapshots to standalone TypeScript/Typia product contracts, reducing the experimental runtime bridge count from 37 to 34. The list update effect is reclassified as reversible (matching templates.update) so its destructive safety hint and confirmation policy align with the standalone contract.
