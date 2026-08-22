---
npm/@listmonk-ops/abtest: minor
npm/@listmonk-ops/operations: minor
---

Checkpoint A/B test creation provisioning phase by phase and reconcile remote campaigns by tag. The create executor now commits after the campaign phase and after the segmentation phase, so a crash before segmentation never re-creates campaigns: campaigns carry deterministic `abtest:<testId>` and `variant:<variantId>` tags, resume reconciles them by tag (adopting exactly-one matches, failing on ambiguity), and only missing variants are created. `provisionTest` adopts committed checkpoints instead of re-provisioning, and the shared finalization path marks the record provisioned. The operation stays experimental — a crash mid-segmentation re-splits the audience with a fresh seed until the segmentation checkpoint reconciles tagged lists the same way.
