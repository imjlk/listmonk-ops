---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/cli: minor
---

Promote `ops.subscribers.hygiene` from experimental to stable — the final experimental descriptor (103 → 104 stable contracts, 0 experimental remaining). The dry run now reports each selected subscriber's `updated_at` observation (`candidateUpdatedAt` in the output), and the destructive echo carries them as `subscriber_guards` (CLI `--subscriber-guards`), validated to cover exactly the echoed `subscriber_ids`. Listmonk advances `updated_at` on the very mutations the workflow performs — list adds and blocklisting — so the guard is the durable per-subscriber completion signal the spec's graduation criterion asked for: a guarded destructive retry skips subscribers its own first attempt already touched and ones that changed or re-entered eligibility externally (reported as `skippedGuarded`), while untouched members of the echoed set still run. Retry semantics are conditional and honest: dry runs are trivially safe, a destructive run with the full guard set classifies as safe, and a destructive run without guards keeps the unsafe classification because a re-eligible subscriber would receive a new effect.
