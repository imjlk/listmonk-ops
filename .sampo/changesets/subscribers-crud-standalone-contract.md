---
npm/@listmonk-ops/operations: minor
---

Migrate `subscribers.create`, `subscribers.update`, and `subscribers.delete` from runtime-operation bridge snapshots to standalone TypeScript/Typia product contracts, reducing the experimental runtime bridge count from 34 to 31. SubscriberUpdateInput is modeled as a union requiring at least one mutable field (matching the runtime refine), and subscriber email fields use the shared EmailAddress tag.
