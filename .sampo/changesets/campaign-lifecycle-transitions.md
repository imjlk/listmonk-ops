---
npm/@listmonk-ops/openapi: patch (Fixed)
npm/@listmonk-ops/operations: minor (Added)
npm/@listmonk-ops/abtest: patch (Fixed)
npm/@listmonk-ops/mcp: minor (Added)
npm/@listmonk-ops/cli: minor (Added)
---

Align the campaign lifecycle with Listmonk 6.2's `UpdateCampaignStatus` rules and add `campaigns.unschedule` (135 → 136 described operations). A paused campaign (for example one the deliverability guard paused) can now be cancelled or rescheduled instead of being rejected locally, and starting a `scheduled` campaign is rejected before any API call with guidance instead of failing with a server 400. The new stable `campaigns.unschedule` returns a scheduled campaign to `draft` (CLI: `listmonk-cli campaigns unschedule --id N`; MCP: `listmonk_unschedule_campaign`), which is the executable path to send a scheduled campaign early; the OpenAPI overlay accepts `draft` on the status endpoint. Stopping an A/B test now cancels a paused variant campaign instead of deleting it and its delivery history.
