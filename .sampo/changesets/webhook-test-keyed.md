---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/operations: minor
---

Give `webhooks.test` keyed-probe deduplication. A probe keyed by `correlation_id` derives a deterministic event id from the endpoint and correlation id, so the outbox dedup collapses an identical retry onto the already-queued delivery; the replay resolves the persisted delivery directly by event (both stores), resumes a still-claimable or lease-expired record, reports a terminal one as `replayed: true` with a consistent skipped summary, and rejects probes whose endpoint is disabled or missing. The operation stays experimental: a retry or expired lease whose first attempt already reached the endpoint redelivers the ping.
