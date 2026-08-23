---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/cli: minor
---

Promote `webhooks.tick` from experimental to stable with the same echoed-claim-set recovery contract as `sequences.tick`, bound to the originally claimed attempt count. The tick's dispatch output echoes the exact claimed deliveries with their attempt counts at claim (`claim_steps`), and an identical retry carrying that echoed set as `recovery_set` (CLI `--recovery-set`) runs a convergent recovery pass over exactly those positions: an entry is re-claimed only while its current attempt count still matches the echo — a delivery anyone has attempted since, already succeeded or exhausted, holding a live lease, sitting in backoff, or facing an open circuit is skipped, with the retryable ones reported as `pending_ids` — so the retry never claims new due work and never delivers past the originally claimed position. The reconcile phase of the tick remains idempotent lease maintenance. File and PostgreSQL webhook stores gain attempt-count binding on targeted claims, and fresh ticks (without the echoed set) keep the honest at-least-once reconcile classification. The stable TypeScript contract count rises from 89 to 90.
