---
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/abtest: minor
---

Migrate all 12 remaining A/B test operations from runtime-operation bridge snapshots to standalone TypeScript/Typia product contracts. The experimental runtime bridge count drops from 13 to 0, completing the full bridge-to-standalone migration. All 104 shared operations now use standalone TypeScript contracts authored with Typia.
