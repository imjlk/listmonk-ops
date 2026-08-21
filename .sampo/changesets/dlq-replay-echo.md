---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/cli: minor
---

Promote `webhooks.dlq.replay` from experimental to stable with the prune echo pattern. The replay input accepts an optional `delivery_ids` set (CLI `--delivery-ids`, required with `--no-dry-run`): destructive runs requeue exactly the echoed dead-letter set, records that already left the dead-letter set are skipped, and an identical retry is a documented no-op. Dry runs preview the bounded newest batch and report the eligible ids to echo. The stable TypeScript contract count rises from 82 to 83.
