---
npm/@listmonk-ops/automation: patch
npm/@listmonk-ops/abtest: patch
---

Harden two persistence boundaries left open by review on the recent stabilization batches. Segment drift sample keys are now rejected before writing when they exceed the published 200-trimmed-character contract, and persisted overlength keys are rejected when the store is read. The A/B test store validates `provisionedAt` as a real timestamp instead of any string.
