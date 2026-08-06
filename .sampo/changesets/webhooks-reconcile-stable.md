---
npm/@listmonk-ops/operations: patch
---

Correct the retry semantics on `webhooks.reconcile`: the operation was described as a safe idempotent no-op, but reconciliation is bounded by a per-call limit and an ambiguous retry can select and mutate the next batch of expired deliveries. Switch retry to `kind: "reconcile"` with `idempotent: false` and update the agent retry guidance to verify the remaining backlog in dry-run mode before retrying. The operation stays `experimental` pending a request-level idempotency guarantee.
