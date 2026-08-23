---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/cli: minor
---

Promote `sequences.tick` from experimental to stable with an echoed-claim-set recovery contract. The tick output now echoes the exact claimed enrollment ids (`claimed_ids`), and an identical retry carrying that echoed set runs a convergent recovery pass over exactly those enrollments: still-claimable members are re-claimed and executed under the same eligibility rule as a fresh tick, while members that already advanced, completed, turned ambiguous, or hold a live lease are skipped — so the retry never claims new due work, ambiguous members stay untouched until an operator reconciles them, and repeated retries converge (transactional idempotency still prevents duplicate sends for re-executed steps). File and PostgreSQL sequence stores gain a `claimSpecific` repository operation, and the CLI tick command accepts `--claimed-ids` for the recovery pass. Fresh ticks (without the echoed set) keep the honest reconcile classification because they claim whatever is due at request time. The stable TypeScript contract count rises from 88 to 89.
