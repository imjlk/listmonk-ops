# Email Operations Specification

> Generated from `@listmonk-ops/operations/specs`. Do not edit manually.

## `campaigns.get`

Get a campaign by ID

- Resource / verb: `campaign.get`
- MCP tool: `listmonk_get_campaign`
- Effects: `read:campaign`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.6.0`

## `campaigns.schedule`

Schedule a campaign to send at a specific time. Validates the current status allows the transition. Destructive because a scheduled campaign will begin mass delivery at the configured time.

- Resource / verb: `campaign.schedule`
- MCP tool: `listmonk_schedule_campaign`
- Effects: `delivery:bulk:scheduled`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `reconcile`
- Stability: `experimental` since `0.6.0`
- State: `draft -> scheduled` (target-state no-op allowed)

## `subscribers.blocklist`

Add a batch of subscribers to the blocklist (action: add). Processes subscribers in chunks and supports dry-run, max-items cap, and continue-on-error. Destructive because blocklisting suppresses mail delivery for the entire batch.

- Resource / verb: `subscriber.blocklist`
- MCP tool: `listmonk_blocklist_subscribers`
- Effects: `suppression:audience`
- Policy: confirmation `required`, audit `required`, dry-run `true`
- Retry: `safe`
- Stability: `experimental` since `0.6.0`
- State: `enabled | disabled -> blocklisted` (target-state no-op allowed)
