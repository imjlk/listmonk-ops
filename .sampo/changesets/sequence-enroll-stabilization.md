---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/cli: minor
---

Promote `sequences.enroll` from experimental to stable (102 → 103 stable contracts, 1 experimental remaining). The enroll input gains an `expected_prior_enrollments` generation guard (CLI `--expected-prior-enrollments`): the caller echoes the number of enrollments — any status — that already existed for the sequence and subscriber, observed via `sequences.enrollments.list`. The repository's `createEnrollment` verifies the count inside the store transaction (file store and Postgres), so concurrent guarded retries cannot double-create. A guarded ambiguous retry then converges across the whole lifecycle: it creates only while the count still matches, replays the single landed enrollment as `created: false` even after it reached a terminal status (closing the re-entry hazard that kept the operation experimental — an unguarded repeat restarts a terminal lifecycle), and conflicts when more than one enrollment landed or the landed one carries a different context. Intentional re-enrollment stays explicit: a request without the guard still starts a fresh lifecycle after a terminal enrollment, and that case keeps the honest non-idempotent classification.
