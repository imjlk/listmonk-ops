---
npm/@listmonk-ops/operations: minor
---

Publish a seventh guarded typed playbook, `webhook.retention`. It walks the stable exact-set prune flow end to end: a human-approved dry run previews the oldest terminal delivery batch past a retention window, and the deletion step echoes the preview's exact delivery ids and `before` cutoff so the confirmed deletion cannot drift and a retry is a no-op. Recovery points at `webhooks.delivery.list`.
