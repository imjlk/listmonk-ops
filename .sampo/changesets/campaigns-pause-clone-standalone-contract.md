---
npm/@listmonk-ops/operations: minor
---

Migrate `campaigns.pause` and `campaigns.clone` from runtime-operation bridge snapshots to standalone TypeScript/Typia product contracts, reducing the experimental runtime bridge count from 26 to 24. Campaigns.pause reuses the existing lifecycle contract; campaigns.clone introduces a CampaignCloneInput contract.
