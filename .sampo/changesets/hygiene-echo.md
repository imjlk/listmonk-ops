---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/cli: minor
---

Give `ops.subscribers.hygiene` echoed candidate sets. The input accepts an optional `subscriber_ids` set (CLI `--subscriber-ids`, strictly parsed; required when `dry_run` is false, enforced both at the operation boundary and in the exported workflow): destructive runs process exactly the echoed set, subscribers that left the eligible set are skipped, echoed sets larger than the effective limit are rejected instead of truncated, and winback additions are per-subscriber idempotent memberships. The operation stays experimental — a subscriber that re-enters eligibility is re-selected by the identical echoed request, the same re-entry hazard that keeps dead-letter replay experimental.
