---
npm/@listmonk-ops/abtest: patch
---

Fix unresolved review findings across Change Sets A-E: deep-clone locked hypotheses to prevent caller-mutation checksum invalidation, include revenue columns in reports when revenue_per_recipient is the primary metric, reject missing group keys in stratification, and remove dead duplicate validation.
