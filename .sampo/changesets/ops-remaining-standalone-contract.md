---
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/automation: minor
---

Migrate all six remaining ops workflow operations (deliverability-guard, subscriber-hygiene, registry-sync, registry-history, registry-promote, registry-rollback) from runtime-operation bridge snapshots to standalone TypeScript/Typia product contracts, reducing the experimental runtime bridge count from 19 to 13. The ops workflow family is now fully standalone.
