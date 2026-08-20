---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/operations: minor
---

Promote `ops.segments.drift` from experimental to stable with conditional retry semantics. A completed keyed sample now replays from the store — an identical retry returns the originally committed measurement without fetching live counts or overwriting the period's sample — while unkeyed snapshots stay unsafe appends, matching the established `transactional.send` conditional precedent. `webhooks.delivery.retry` gains a pending no-op (a repeat while the delivery is still queued reports `retried: false` without another mutation, in both the file and Postgres stores) but stays experimental because a dispatcher can complete the pending delivery first, letting a repeat start another delivery cycle. Dead-letter replay aggregation now skips concurrent no-op requeues so the replayed count stays honest. The stable TypeScript contract count rises from 80 to 81.
