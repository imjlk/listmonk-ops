---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/abtest: minor
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/cli: minor
---

Promote five operations from experimental to stable (96 → 101 stable contracts, 3 experimental remaining). `abtest.run` classifies conditionally: with both revision guards (`expected_status` + `expected_updated_at`) an identical retry converges — the guards are verified inside the store transaction, a moved test conflicts, and a terminal test is a documented no-op. `abtest.deploy-winner` becomes retry-safe through tag adoption: a retry first looks for a campaign already tagged `winner:deployed` for the test — left by a completed prior call or one whose local commit was lost — and adopts it as the winner campaign instead of creating a second holdout delivery. `webhooks.dispatch` gains the tick's attempt-bound `recovery_set` contract (CLI `--recovery-set`): an echoed retry claims exactly the originally claimed deliveries at their originally claimed attempt counts, though delivery itself honestly stays at-least-once (reconcile classification). `ops.templates.registry-promote` promotes with its already-safe convergent semantics, and `ops.templates.registry-rollback` accepts a `from_version_id` source pin that detects the ABA transition (promoting the original version back) and an `expected_remote_hash` pin that detects out-of-registry remote drift, both verified inside the store lock alongside the existing target pin — a fully-pinned retry converges, and any pin-less retry keeps the honest unsafe classification.
