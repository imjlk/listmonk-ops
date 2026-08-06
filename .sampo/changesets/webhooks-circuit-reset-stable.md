---
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/automation: minor
---

Promote `webhooks.circuit.reset` from `experimental` to `stable`. Short-circuit both the file and Postgres repositories so resetting an already-closed circuit with zero failures is a true no-op that does not replace the runtime record, matching the spec's idempotent retry claim. Preserve file-backed success and failure history across reset results, and lock the Postgres endpoint row before deciding whether reset is a no-op so concurrent delivery completion cannot invalidate the returned state. The stable TypeScript contract count rises from 42 to 43.
