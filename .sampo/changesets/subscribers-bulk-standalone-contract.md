---
npm/@listmonk-ops/operations: minor
---

Migrate `subscribers.add-to-lists`, `subscribers.remove-from-lists`, and `subscribers.unblocklist` from runtime-operation bridge snapshots to standalone TypeScript/Typia product contracts, reducing the experimental runtime bridge count from 24 to 21. All three operations share the existing SubscriberBulkOutput contract; add-to-lists and remove-from-lists share SubscriberBulkListsInput, while unblocklist uses SubscriberBulkBlocklistInput.
