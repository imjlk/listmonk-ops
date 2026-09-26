---
npm/@listmonk-ops/operations: patch (Fixed)
npm/@listmonk-ops/mcp: patch (Fixed)
npm/@listmonk-ops/cli: patch (Fixed)
---

Align the client-side campaign lifecycle table with Listmonk 6.2's `UpdateCampaignStatus` rules. A paused campaign (for example one the deliverability guard paused) can now be cancelled or rescheduled instead of being rejected locally, and starting a `scheduled` campaign is rejected before any API call with guidance to unschedule it first, instead of passing the local check and failing with a server 400. Invalid transitions to `cancelled` from `draft`/`scheduled` explain that the campaign should be deleted.
