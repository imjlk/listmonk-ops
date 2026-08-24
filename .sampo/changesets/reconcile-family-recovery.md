---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/abtest: minor
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/cli: minor
---

Promote the three reconcile operations from experimental to stable with an echoed-scanned-set recovery contract. `sequences.reconcile`, `webhooks.reconcile`, and `abtest.reconcile` each echo the exact record ids their scan considered (`scanned_ids`), and an identical retry carrying that echo as `recovery_set` re-examines exactly that batch: leases already recovered by the original call are no longer expired and are skipped, drift already repaired no longer matches its repair condition, and the retry never selects the next backlog batch — so it converges over the echoed set. The sequences ambiguous-send resolution mode is independently convergent (it requires the enrollment to still be in the ambiguous status, so a retry after a completed resolution is rejected rather than re-applied). File and PostgreSQL sequence stores gain an enrollmentIds bound on the expired-lease scan; the webhook reconcile gains a deliveryIds bound in both stores; the A/B reconcile filters its examination to the echoed test ids and rejects duplicate echoed ids. Fresh scans (without the echoed set) keep the honest reconcile/unsafe classifications because a bounded scan selects the next backlog batch after an ambiguous result. The stable TypeScript contract count rises from 91 to 94.
