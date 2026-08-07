---
npm/@listmonk-ops/operations: minor
---

Migrate `campaigns.create`, `campaigns.update`, and `campaigns.delete` from runtime-operation bridge snapshots to standalone TypeScript/Typia product contracts, reducing the experimental runtime bridge count from 31 to 28. CampaignUpdateInput is modeled as an inclusive union (anyOf) requiring at least one mutable field. `campaigns.pause` and `campaigns.clone` remain bridged.
