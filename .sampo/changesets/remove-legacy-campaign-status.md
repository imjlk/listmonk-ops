---
npm/@listmonk-ops/mcp: major (Removed)
---

Remove deprecated legacy `listmonk_update_campaign_status` MCP tool. Callers should migrate to the shared lifecycle operations: `listmonk_schedule_campaign`, `listmonk_start_campaign`, `listmonk_pause_campaign`, and `listmonk_cancel_campaign`, which provide proper safety metadata, confirmation gates, audit trails, and state-machine validation.
