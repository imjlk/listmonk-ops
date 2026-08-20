---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/operations: minor
---

Promote `webhooks.delivery.retry` and `ops.segments.drift` from experimental to stable. Requesting a delivery retry once the delivery is already pending now reports `retried: false` and returns the queued record without another mutation (both the file and Postgres stores), and the drift operation declares conditional retry semantics — keyed snapshots replace their sampling period so identical retries converge, while unkeyed appends stay unsafe, matching the established `transactional.send` conditional precedent. The stable TypeScript contract count rises from 80 to 82.
