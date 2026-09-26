---
npm/@listmonk-ops/automation: patch (Fixed)
npm/@listmonk-ops/operations: patch (Fixed)
npm/@listmonk-ops/cli: patch (Fixed)
npm/@listmonk-ops/mcp: patch (Fixed)
---

Let the deliverability guard pause campaigns that are actively sending without pausing healthy fast sends. The guard now reads the campaign after listing its bounces, so rates never divide by a `sent` count older than the bounce count, and it reports and decides from that one snapshot; a campaign that stopped running meanwhile is reported instead of paused. Its auto-pause is bound to that observed `running` status instead of the campaign's `updated_at`, which Listmonk advances on every send batch and which made the pause fail with "changed after preflight" exactly when a fast, high-bounce send needed stopping. The shared lifecycle transition still re-reads the campaign before the write, treats an already paused campaign as a no-op, and fails closed without a status write if the campaign has finished or been cancelled; manual `campaigns.pause` keeps its exact `expected_updated_at` check.
