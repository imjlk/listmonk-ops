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

## `specs.search`

Search shared Listmonk operation contracts and agent guidance by intent, family, resource, or verb.

- Resource / verb: `spec.search`
- MCP tool: `listmonk_schema_search`
- Effects: `read:spec`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.8.0`

## `specs.describe`

Describe one shared operation by operation ID or MCP tool name, including safety, retry, and agent guidance.

- Resource / verb: `spec.describe`
- MCP tool: `listmonk_schema_describe`
- Effects: `read:spec`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.8.0`

## `playbooks.list`

List typed operation playbooks that encode safe multi-step Listmonk workflows.

- Resource / verb: `playbook.list`
- MCP tool: `listmonk_list_playbooks`
- Effects: `read:playbook`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.8.0`

## `playbooks.get`

Get a typed operation playbook and the operation contracts referenced by its steps.

- Resource / verb: `playbook.get`
- MCP tool: `listmonk_playbook_get`
- Effects: `read:playbook`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.8.0`

## `control.capabilities`

Summarize shared operation families, typed specification coverage, resources, and playbooks.

- Resource / verb: `control.capabilities`
- MCP tool: `listmonk_capabilities`
- Effects: `read:control`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.8.0`

## `control.prime`

Return installation capabilities and goal-oriented operation and playbook recommendations for an AI agent.

- Resource / verb: `control.prime`
- MCP tool: `listmonk_prime`
- Effects: `read:control`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.8.0`

## `control.status`

Check catalog integrity, typed specification coverage, runtime identity, and live Listmonk connectivity.

- Resource / verb: `control.status`
- MCP tool: `listmonk_status`
- Effects: `read:control`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.8.0`

## `webhooks.list`

List configured outbound webhook endpoints without exposing signing secret values.

- Resource / verb: `webhook.list`
- MCP tool: `listmonk_webhooks_list`
- Effects: `read:webhook`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.8.0`

## `webhooks.create`

Create an HTTPS endpoint using an environment-variable secret reference and typed event filters.

- Resource / verb: `webhook.create`
- MCP tool: `listmonk_webhooks_create`
- Effects: `write:webhook`
- Policy: confirmation `never`, audit `required`, dry-run `false`
- Retry: `reconcile`
- Stability: `experimental` since `0.8.0`

## `webhooks.update`

Update endpoint metadata, delivery policy, enabled state, or event filters without storing a secret value.

- Resource / verb: `webhook.update`
- MCP tool: `listmonk_webhooks_update`
- Effects: `write:webhook`
- Policy: confirmation `never`, audit `required`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.8.0`

## `webhooks.delete`

Delete an endpoint and exhaust its unfinished delivery records.

- Resource / verb: `webhook.delete`
- MCP tool: `listmonk_webhooks_delete`
- Effects: `delete:webhook`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `reconcile`
- Stability: `experimental` since `0.8.0`

## `webhooks.test`

Queue and immediately send one signed webhook.test event to a selected endpoint.

- Resource / verb: `webhook.test`
- MCP tool: `listmonk_webhooks_test`
- Effects: `webhook:single`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `unsafe`
- Stability: `experimental` since `0.8.0`

## `webhooks.dispatch`

Claim due outbox deliveries and send signed HTTPS requests with bounded retries.

- Resource / verb: `webhook.dispatch`
- MCP tool: `listmonk_webhooks_dispatch`
- Effects: `webhook:bulk`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `reconcile`
- Stability: `experimental` since `0.8.0`

## `webhooks.delivery.list`

Inspect redacted outbox delivery state, attempts, status codes, and exhausted errors.

- Resource / verb: `webhook.list`
- MCP tool: `listmonk_webhook_deliveries_list`
- Effects: `read:webhook`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.8.0`

## `webhooks.delivery.retry`

Requeue one retryable or exhausted delivery for a fresh bounded attempt cycle.

- Resource / verb: `webhook.retry`
- MCP tool: `listmonk_webhook_delivery_retry`
- Effects: `write:webhook`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `reconcile`
- Stability: `experimental` since `0.8.0`

## `webhooks.reconcile`

Recover expired worker leases and exhaust deliveries whose endpoint is missing or disabled.

- Resource / verb: `webhook.reconcile`
- MCP tool: `listmonk_webhooks_reconcile`
- Effects: `maintenance:recover:recoverable`
- Policy: confirmation `never`, audit `required`, dry-run `true`
- Retry: `safe`
- Stability: `experimental` since `0.8.0`

## `webhooks.prune`

Preview or delete bounded terminal delivery records older than a retention cutoff.

- Resource / verb: `webhook.prune`
- MCP tool: `listmonk_webhooks_prune`
- Effects: `maintenance:prune:destructive`
- Policy: confirmation `required`, audit `required`, dry-run `true`
- Retry: `safe`
- Stability: `experimental` since `0.8.0`

## `webhooks.tick`

Reconcile expired leases, claim due outbox records, and send one bounded delivery batch.

- Resource / verb: `webhook.tick`
- MCP tool: `listmonk_webhooks_tick`
- Effects: `webhook:bulk`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `reconcile`
- Stability: `experimental` since `0.8.0`
