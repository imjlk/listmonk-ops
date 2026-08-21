---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/operations: minor
---

Promote `webhooks.test` from experimental to stable with conditional retry semantics. A probe keyed by `correlation_id` derives a deterministic event id from the endpoint and correlation id, so the outbox dedup collapses an identical retry onto the already-queued delivery and reports `replayed: true` without dispatching another ping; unkeyed probes queue a fresh delivery and stay unsafe. The stable TypeScript contract count rises from 82 to 83.
