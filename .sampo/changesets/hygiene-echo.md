---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/cli: minor
---

Promote `ops.subscribers.hygiene` from experimental to stable with the echo pattern. The input accepts an optional `subscriber_ids` set (CLI `--subscriber-ids`, required when `dry_run` is false, modeled as a discriminated contract union): destructive runs process exactly the echoed candidate set, subscribers that left the eligible set (blocklisted, reactivated, no longer inactive) are skipped on retry, and winback list additions are per-subscriber idempotent memberships, so an identical retry applies no new effect. Dry runs preview the bounded newest batch and report the selected subscriber ids to echo. The stable TypeScript contract count rises from 82 to 83.
