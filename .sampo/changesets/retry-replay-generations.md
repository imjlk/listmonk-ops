---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/cli: minor
---

Promote `webhooks.delivery.retry` and `webhooks.dlq.replay` from experimental to stable with generation-bound retries. `webhooks.delivery.retry` accepts an optional `expected_manual_retry_count` (CLI `--expected-manual-retry-count`) — the delivery's pre-request generation echoed from a prior retry's retry_generation output (not the post-retry manual_retry_count, which is already incremented) — and a repeat bound to it only fires while the delivery still sits at that generation: a repeat while the original retry's pending state holds reports `retried: false`, and a delivery a dispatcher already completed and returned to retry moved to a later generation and is reported unmodified instead of starting another delivery cycle. `webhooks.dlq.replay` echoes each candidate dead letter's generation (`replayed_generations`) and accepts it back as `recovery_generations` (CLI `--recovery-generations`): a record is replayed only while it is still exhausted at its echoed manual retry count, so a record a worker re-exhausted after the replay — the re-entry hazard that kept the replay experimental — is skipped rather than replayed again. Both stores implement the generation filters (in-transaction in PostgreSQL). Unechoed retries keep the honest reconcile classifications. The stable TypeScript contract count rises from 94 to 96.
