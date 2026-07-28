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

## `campaigns.start`

Transition a campaign into the running status. Validates the current status allows the transition. Destructive because this begins mass delivery immediately.

- Resource / verb: `campaign.start`
- MCP tool: `listmonk_start_campaign`
- Effects: `delivery:bulk:immediate`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `reconcile`
- Stability: `experimental` since `0.7.0`
- State: `draft | scheduled | paused -> running` (target-state no-op allowed)

## `campaigns.cancel`

Transition a campaign into the cancelled status. Validates the current status allows the transition. Destructive because the cancellation is irreversible.

- Resource / verb: `campaign.cancel`
- MCP tool: `listmonk_cancel_campaign`
- Effects: `write:campaign`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `reconcile`
- Stability: `experimental` since `0.7.0`
- State: `running -> cancelled` (target-state no-op allowed)

## `transactional.send`

Send a transactional email through Listmonk

- Resource / verb: `message.send`
- MCP tool: `listmonk_send_transactional`
- Effects: `delivery:single:immediate`
- Policy: confirmation `never`, audit `required`, dry-run `false`
- Retry: `conditional`
- Stability: `experimental` since `0.7.0`

## `ops.campaign.preflight`

Run pre-send checks against a Listmonk campaign

- Resource / verb: `campaign.preflight`
- MCP tool: `listmonk_ops_preflight`
- Effects: `read:campaign`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.7.0`
