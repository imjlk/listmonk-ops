---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/cli: minor
---

Apply the prune echo pattern to `webhooks.dlq.replay`. The input accepts an optional `delivery_ids` set (CLI `--delivery-ids`, required with `--no-dry-run`, modeled as a discriminated contract union): destructive runs requeue exactly the echoed dead-letter set and records that already left the dead-letter set are skipped in both the file and repository paths, so an identical retry replays nothing new. The operation stays experimental — a worker can re-exhaust a replayed record before the retry, making the identical echoed request eligible again.
