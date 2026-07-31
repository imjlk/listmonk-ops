# Email Operations Specification

> Generated from `@listmonk-ops/operations/specs`. Do not edit manually.

## `campaigns.get`

Get a campaign by ID

- Resource / verb: `campaign.get`
- MCP tool: `listmonk_get_campaign`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:campaign`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `stable` since `0.6.0`

## `campaigns.schedule`

Schedule a campaign to send at a specific time. Validates the current status allows the transition. Destructive because a scheduled campaign will begin mass delivery at the configured time.

- Resource / verb: `campaign.schedule`
- MCP tool: `listmonk_schedule_campaign`
- Contract source: input `typescript`, output `typescript`
- Effects: `delivery:bulk:scheduled`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `reconcile`
- Stability: `stable` since `0.6.0`
- State: `draft -> scheduled` (target-state no-op allowed)

## `subscribers.blocklist`

Add a batch of subscribers to the blocklist (action: add). Processes subscribers in chunks and supports dry-run, max-items cap, and continue-on-error. Destructive because blocklisting suppresses mail delivery for the entire batch.

- Resource / verb: `subscriber.blocklist`
- MCP tool: `listmonk_blocklist_subscribers`
- Contract source: input `typescript`, output `typescript`
- Effects: `suppression:audience`
- Policy: confirmation `required`, audit `required`, dry-run `true`
- Retry: `safe`
- Stability: `stable` since `0.6.0`
- State: `enabled | disabled -> blocklisted` (target-state no-op allowed)

## `campaigns.start`

Transition a campaign into the running status. Validates the current status allows the transition. Destructive because this begins mass delivery immediately.

- Resource / verb: `campaign.start`
- MCP tool: `listmonk_start_campaign`
- Contract source: input `typescript`, output `typescript`
- Effects: `delivery:bulk:immediate`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `reconcile`
- Stability: `stable` since `0.7.0`
- State: `draft | scheduled | paused -> running` (target-state no-op allowed)

## `campaigns.cancel`

Transition a campaign into the cancelled status. Validates the current status allows the transition. Destructive because the cancellation is irreversible.

- Resource / verb: `campaign.cancel`
- MCP tool: `listmonk_cancel_campaign`
- Contract source: input `typescript`, output `typescript`
- Effects: `write:campaign`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `reconcile`
- Stability: `stable` since `0.7.0`
- State: `running -> cancelled` (target-state no-op allowed)

## `transactional.send`

Send a transactional email through Listmonk

- Resource / verb: `message.send`
- MCP tool: `listmonk_send_transactional`
- Contract source: input `typescript`, output `typescript`
- Effects: `delivery:single:immediate`
- Policy: confirmation `never`, audit `required`, dry-run `false`
- Retry: `conditional`
- Stability: `stable` since `0.7.0`

## `ops.campaign.preflight`

Run pre-send checks against a Listmonk campaign

- Resource / verb: `campaign.preflight`
- MCP tool: `listmonk_ops_preflight`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:campaign`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `stable` since `0.7.0`

## `specs.search`

Search shared Listmonk operation contracts and agent guidance by intent, family, resource, or verb.

- Resource / verb: `spec.search`
- MCP tool: `listmonk_schema_search`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:spec`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `stable` since `0.8.0`

## `specs.describe`

Describe one shared operation by operation ID or MCP tool name, including safety, retry, and agent guidance.

- Resource / verb: `spec.describe`
- MCP tool: `listmonk_schema_describe`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:spec`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `stable` since `0.8.0`

## `playbooks.list`

List typed operation playbooks that encode safe multi-step Listmonk workflows.

- Resource / verb: `playbook.list`
- MCP tool: `listmonk_list_playbooks`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:playbook`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `stable` since `0.8.0`

## `playbooks.get`

Get a typed operation playbook and the operation contracts referenced by its steps.

- Resource / verb: `playbook.get`
- MCP tool: `listmonk_playbook_get`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:playbook`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `stable` since `0.8.0`

## `control.capabilities`

Summarize shared operation families, typed specification coverage, resources, and playbooks.

- Resource / verb: `control.capabilities`
- MCP tool: `listmonk_capabilities`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:control`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `stable` since `0.8.0`

## `control.prime`

Return installation capabilities and goal-oriented operation and playbook recommendations for an AI agent.

- Resource / verb: `control.prime`
- MCP tool: `listmonk_prime`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:control`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `stable` since `0.8.0`

## `control.status`

Check catalog integrity, typed specification coverage, runtime identity, and live Listmonk connectivity.

- Resource / verb: `control.status`
- MCP tool: `listmonk_status`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:control`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.8.0`

## `webhooks.list`

List configured outbound webhook endpoints without exposing signing secret values.

- Resource / verb: `webhook.list`
- MCP tool: `listmonk_webhooks_list`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:webhook`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.8.0`

## `webhooks.create`

Create an HTTPS endpoint using an environment-variable secret reference and typed event filters.

- Resource / verb: `webhook.create`
- MCP tool: `listmonk_webhooks_create`
- Contract source: input `typescript`, output `typescript`
- Effects: `write:webhook`
- Policy: confirmation `never`, audit `required`, dry-run `false`
- Retry: `reconcile`
- Stability: `experimental` since `0.8.0`

## `webhooks.update`

Update endpoint metadata, delivery policy, enabled state, or event filters without storing a secret value.

- Resource / verb: `webhook.update`
- MCP tool: `listmonk_webhooks_update`
- Contract source: input `typescript`, output `typescript`
- Effects: `write:webhook`
- Policy: confirmation `never`, audit `required`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.8.0`

## `webhooks.delete`

Delete an endpoint and exhaust its unfinished delivery records.

- Resource / verb: `webhook.delete`
- MCP tool: `listmonk_webhooks_delete`
- Contract source: input `typescript`, output `typescript`
- Effects: `delete:webhook`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `reconcile`
- Stability: `experimental` since `0.8.0`

## `webhooks.test`

Queue and immediately send one signed webhook.test event to a selected endpoint.

- Resource / verb: `webhook.test`
- MCP tool: `listmonk_webhooks_test`
- Contract source: input `typescript`, output `typescript`
- Effects: `webhook:single`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `unsafe`
- Stability: `experimental` since `0.8.0`

## `webhooks.dispatch`

Claim due outbox deliveries and send signed HTTPS requests with bounded retries.

- Resource / verb: `webhook.dispatch`
- MCP tool: `listmonk_webhooks_dispatch`
- Contract source: input `typescript`, output `typescript`
- Effects: `webhook:bulk`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `reconcile`
- Stability: `experimental` since `0.8.0`

## `webhooks.delivery.list`

Inspect redacted outbox delivery state, attempts, status codes, and exhausted errors.

- Resource / verb: `webhook.list`
- MCP tool: `listmonk_webhook_deliveries_list`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:webhook`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.8.0`

## `webhooks.delivery.retry`

Requeue one retryable or exhausted delivery for a fresh bounded attempt cycle.

- Resource / verb: `webhook.retry`
- MCP tool: `listmonk_webhook_delivery_retry`
- Contract source: input `typescript`, output `typescript`
- Effects: `write:webhook`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `reconcile`
- Stability: `experimental` since `0.8.0`

## `webhooks.reconcile`

Recover expired worker leases and exhaust deliveries whose endpoint is missing or disabled.

- Resource / verb: `webhook.reconcile`
- MCP tool: `listmonk_webhooks_reconcile`
- Contract source: input `typescript`, output `typescript`
- Effects: `maintenance:recover:recoverable`
- Policy: confirmation `never`, audit `required`, dry-run `true`
- Retry: `safe`
- Stability: `experimental` since `0.8.0`

## `webhooks.prune`

Preview or delete bounded terminal delivery records older than a retention cutoff.

- Resource / verb: `webhook.prune`
- MCP tool: `listmonk_webhooks_prune`
- Contract source: input `typescript`, output `typescript`
- Effects: `maintenance:prune:destructive`
- Policy: confirmation `required`, audit `required`, dry-run `true`
- Retry: `safe`
- Stability: `experimental` since `0.8.0`

## `webhooks.tick`

Reconcile expired leases, claim due outbox records, and send one bounded delivery batch.

- Resource / verb: `webhook.tick`
- MCP tool: `listmonk_webhooks_tick`
- Contract source: input `typescript`, output `typescript`
- Effects: `webhook:bulk`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `reconcile`
- Stability: `experimental` since `0.8.0`

## `webhooks.runtime.status`

Inspect durable schema, endpoint circuit, dead-letter, delivery, and worker heartbeat health.

- Resource / verb: `webhook.status`
- MCP tool: `listmonk_webhooks_runtime_status`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:webhook`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.8.0`

## `webhooks.inbound.ingest`

Normalize a verified provider delivery event into the shared versioned event envelope and durable outbox; unsubscribe events require a subscriber UUID and metadata is limited to 16 KiB.

- Resource / verb: `webhook.ingest`
- MCP tool: `listmonk_webhooks_inbound_ingest`
- Contract source: input `typescript`, output `typescript`
- Effects: `write:webhook`
- Policy: confirmation `never`, audit `required`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.8.0`

## `webhooks.dlq.list`

List exhausted delivery records that require operator review.

- Resource / verb: `webhook.list`
- MCP tool: `listmonk_webhooks_dlq_list`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:webhook`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.8.0`

## `webhooks.dlq.replay`

Preview or requeue a bounded set of reviewed dead-letter deliveries.

- Resource / verb: `webhook.replay`
- MCP tool: `listmonk_webhooks_dlq_replay`
- Contract source: input `typescript`, output `typescript`
- Effects: `maintenance:replay:destructive`
- Policy: confirmation `required`, audit `required`, dry-run `true`
- Retry: `reconcile`
- Stability: `experimental` since `0.8.0`

## `webhooks.circuit.reset`

Close one endpoint circuit after the operator has corrected its failure.

- Resource / verb: `webhook.reset`
- MCP tool: `listmonk_webhooks_circuit_reset`
- Contract source: input `typescript`, output `typescript`
- Effects: `write:webhook`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.8.0`

## `sequences.validate`

Validate typed send, wait, wait-until, condition, and stop steps without persisting a sequence.

- Resource / verb: `sequence.validate`
- MCP tool: `listmonk_sequences_validate`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:sequence`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`

## `sequences.create`

Create an active sequence with an immutable first revision.

- Resource / verb: `sequence.create`
- MCP tool: `listmonk_sequences_create`
- Contract source: input `typescript`, output `typescript`
- Effects: `write:sequence`
- Policy: confirmation `never`, audit `required`, dry-run `false`
- Retry: `unsafe`
- Stability: `experimental` since `0.9.0`

## `sequences.update`

Append an immutable revision while existing enrollments stay pinned to their original revision.

- Resource / verb: `sequence.update`
- MCP tool: `listmonk_sequences_update`
- Contract source: input `typescript`, output `typescript`
- Effects: `write:sequence`
- Policy: confirmation `never`, audit `required`, dry-run `false`
- Retry: `unsafe`
- Stability: `experimental` since `0.9.0`

## `sequences.list`

List sequence definitions and their current revisions.

- Resource / verb: `sequence.list`
- MCP tool: `listmonk_sequences_list`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:sequence`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`

## `sequences.get`

Get one sequence definition including immutable revisions.

- Resource / verb: `sequence.get`
- MCP tool: `listmonk_sequences_get`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:sequence`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`

## `sequences.delete`

Delete a sequence only after all of its enrollments have reached terminal states.

- Resource / verb: `sequence.delete`
- MCP tool: `listmonk_sequences_delete`
- Contract source: input `typescript`, output `typescript`
- Effects: `delete:sequence`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `unsafe`
- Stability: `experimental` since `0.9.0`

## `sequences.enroll`

Pin one subscriber to the current immutable sequence revision and schedule its first step.

- Resource / verb: `sequence.enroll`
- MCP tool: `listmonk_sequences_enroll`
- Contract source: input `typescript`, output `typescript`
- Effects: `delivery:single:scheduled`
- Policy: confirmation `never`, audit `required`, dry-run `false`
- Retry: `reconcile`
- Stability: `experimental` since `0.9.0`

## `sequences.enrollments.list`

List sequence enrollments with filters so operators can discover pending, failed, or ambiguous work.

- Resource / verb: `sequence.list`
- MCP tool: `listmonk_sequences_enrollments_list`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:sequence`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`

## `sequences.enrollments.get`

Get one sequence enrollment including its current step, status, and last error.

- Resource / verb: `sequence.get`
- MCP tool: `listmonk_sequences_enrollments_get`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:sequence`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`

## `sequences.pause`

Pause new enrollment execution while preserving durable enrollment state.

- Resource / verb: `sequence.pause`
- MCP tool: `listmonk_sequences_pause`
- Contract source: input `typescript`, output `typescript`
- Effects: `write:sequence`
- Policy: confirmation `never`, audit `required`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`
- State: `active -> paused` (target-state no-op allowed)

## `sequences.resume`

Resume claiming due enrollments for a paused sequence.

- Resource / verb: `sequence.resume`
- MCP tool: `listmonk_sequences_resume`
- Contract source: input `typescript`, output `typescript`
- Effects: `write:sequence`
- Policy: confirmation `never`, audit `required`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`
- State: `paused -> active` (target-state no-op allowed)

## `sequences.tick`

Claim a bounded due-enrollment batch and execute one typed step per enrollment.

- Resource / verb: `sequence.tick`
- MCP tool: `listmonk_sequences_tick`
- Contract source: input `typescript`, output `typescript`
- Effects: `delivery:bulk:immediate`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `reconcile`
- Stability: `experimental` since `0.9.0`

## `sequences.reconcile`

Preview or recover expired enrollment leases, or explicitly resolve one ambiguous send.

- Resource / verb: `sequence.reconcile`
- MCP tool: `listmonk_sequences_reconcile`
- Contract source: input `typescript`, output `typescript`
- Effects: `maintenance:recover:recoverable, maintenance:resolve:destructive`
- Policy: confirmation `required`, audit `required`, dry-run `true`
- Retry: `reconcile`
- Stability: `experimental` since `0.9.0`

## `sequences.status`

Inspect durable schema, definitions, enrollment states, due work, leases, and worker heartbeats.

- Resource / verb: `sequence.status`
- MCP tool: `listmonk_sequences_status`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:sequence`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`

## `providers.list`

List configured provider profiles without exposing credential references.

- Resource / verb: `provider.list`
- MCP tool: `listmonk_providers_list`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:provider`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `stable` since `0.10.0`

## `providers.status`

Inspect provider account, identity, and Listmonk delivery configuration.

- Resource / verb: `provider.status`
- MCP tool: `listmonk_providers_status`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:provider`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `stable` since `0.10.0`

## `providers.test`

Run a bounded read-only provider API authentication and connectivity probe without sending mail.

- Resource / verb: `provider.test`
- MCP tool: `listmonk_providers_test`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:provider`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `stable` since `0.10.0`

## `providers.quota`

Read provider daily quota, rate limit, usage, sandbox, and enforcement status.

- Resource / verb: `provider.quota`
- MCP tool: `listmonk_providers_quota`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:provider`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `stable` since `0.10.0`

## `providers.webhook-status`

Inspect Listmonk bounce webhook configuration and the latest provider event freshness.

- Resource / verb: `provider.webhook-status`
- MCP tool: `listmonk_providers_webhook_status`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:provider`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `stable` since `0.10.0`

## `deliverability.dns-check`

Resolve DMARC, DKIM, custom MAIL FROM SPF/MX, and alignment records for a provider profile.

- Resource / verb: `provider.dns-check`
- MCP tool: `listmonk_deliverability_dns_check`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:provider`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `stable` since `0.10.0`

## `deliverability.doctor`

Compose provider, Listmonk, quota, webhook, and DNS diagnostics into one readiness report.

- Resource / verb: `provider.doctor`
- MCP tool: `listmonk_deliverability_doctor`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:provider`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `stable` since `0.10.0`

## `lists.list`

Get subscriber lists from Listmonk

- Resource / verb: `list.list`
- MCP tool: `listmonk_get_lists`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:list`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `stable` since `0.9.0`

## `lists.get`

Get a specific subscriber list by ID

- Resource / verb: `list.get`
- MCP tool: `listmonk_get_list`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:list`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `stable` since `0.9.0`

## `subscribers.list`

Get subscribers from Listmonk

- Resource / verb: `subscriber.list`
- MCP tool: `listmonk_get_subscribers`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:subscriber`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `stable` since `0.9.0`

## `subscribers.get`

Get a subscriber by ID

- Resource / verb: `subscriber.get`
- MCP tool: `listmonk_get_subscriber`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:subscriber`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `stable` since `0.9.0`

## `campaigns.list`

Get campaigns from Listmonk

- Resource / verb: `campaign.list`
- MCP tool: `listmonk_get_campaigns`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:campaign`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `stable` since `0.9.0`

## `campaigns.stats`

Read delivery stats (views, clicks, bounces, to_send, sent, started_at) for a campaign from Listmonk.

- Resource / verb: `campaign.stats`
- MCP tool: `listmonk_get_campaign_stats`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:campaign`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `stable` since `0.9.0`

## `templates.list`

Get templates from Listmonk

- Resource / verb: `template.list`
- MCP tool: `listmonk_get_templates`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:template`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `stable` since `0.9.0`

## `templates.get`

Get a template by ID

- Resource / verb: `template.get`
- MCP tool: `listmonk_get_template`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:template`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `stable` since `0.9.0`

## `media.list`

Get uploaded media files from Listmonk

- Resource / verb: `media.list`
- MCP tool: `listmonk_get_media`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:media`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `stable` since `0.9.0`

## `media.get`

Get an uploaded media file by ID

- Resource / verb: `media.get`
- MCP tool: `listmonk_get_media_file`
- Contract source: input `typescript`, output `typescript`
- Effects: `read:media`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `stable` since `0.9.0`

## `lists.create`

Create a new subscriber list

- Resource / verb: `list.create`
- MCP tool: `listmonk_create_list`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `write:list`
- Policy: confirmation `never`, audit `required`, dry-run `false`
- Retry: `unsafe`
- Stability: `experimental` since `0.9.0`

## `lists.update`

Update an existing subscriber list

- Resource / verb: `list.update`
- MCP tool: `listmonk_update_list`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `write:list`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`

## `lists.delete`

Delete a subscriber list

- Resource / verb: `list.delete`
- MCP tool: `listmonk_delete_list`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `delete:list`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`

## `subscribers.create`

Create a subscriber in Listmonk

- Resource / verb: `subscriber.create`
- MCP tool: `listmonk_create_subscriber`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `write:subscriber`
- Policy: confirmation `never`, audit `required`, dry-run `false`
- Retry: `unsafe`
- Stability: `experimental` since `0.9.0`

## `subscribers.update`

Update a subscriber in Listmonk

- Resource / verb: `subscriber.update`
- MCP tool: `listmonk_update_subscriber`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `write:subscriber`
- Policy: confirmation `never`, audit `required`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`

## `subscribers.delete`

Delete a subscriber from Listmonk

- Resource / verb: `subscriber.delete`
- MCP tool: `listmonk_delete_subscriber`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `delete:subscriber`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`

## `subscribers.add-to-lists`

Add a batch of subscribers to one or more lists. Processes subscribers in chunks and supports dry-run, max-items cap, and continue-on-error.

- Resource / verb: `subscriber.add-to-lists`
- MCP tool: `listmonk_add_subscribers_to_lists`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `write:subscriber`
- Policy: confirmation `never`, audit `required`, dry-run `true`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`

## `subscribers.remove-from-lists`

Remove a batch of subscribers from one or more lists. Processes subscribers in chunks and supports dry-run, max-items cap, and continue-on-error. Destructive because re-adding subscribers does not guarantee their previous per-list subscription state is reconstructed.

- Resource / verb: `subscriber.remove-from-lists`
- MCP tool: `listmonk_remove_subscribers_from_lists`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `write:subscriber`
- Policy: confirmation `required`, audit `required`, dry-run `true`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`

## `subscribers.unblocklist`

Remove a batch of subscribers from the blocklist. Processes subscribers in chunks and supports dry-run, max-items cap, and continue-on-error.

- Resource / verb: `subscriber.unblocklist`
- MCP tool: `listmonk_unblocklist_subscribers`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `write:subscriber`
- Policy: confirmation `never`, audit `required`, dry-run `true`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`

## `campaigns.create`

Create a campaign in Listmonk

- Resource / verb: `campaign.create`
- MCP tool: `listmonk_create_campaign`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `write:campaign`
- Policy: confirmation `never`, audit `required`, dry-run `false`
- Retry: `unsafe`
- Stability: `experimental` since `0.9.0`

## `campaigns.update`

Update a campaign in Listmonk

- Resource / verb: `campaign.update`
- MCP tool: `listmonk_update_campaign`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `write:campaign`
- Policy: confirmation `never`, audit `required`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`

## `campaigns.delete`

Delete a campaign from Listmonk

- Resource / verb: `campaign.delete`
- MCP tool: `listmonk_delete_campaign`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `delete:campaign`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`

## `campaigns.pause`

Transition a campaign into the paused status. Validates the current status allows the transition.

- Resource / verb: `campaign.pause`
- MCP tool: `listmonk_pause_campaign`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `write:campaign`
- Policy: confirmation `never`, audit `required`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`
- State: `running -> paused` (target-state no-op allowed)

## `campaigns.clone`

Create a new campaign by copying the body, lists, template, and metadata of an existing campaign under a new name. The clone starts in draft status.

- Resource / verb: `campaign.clone`
- MCP tool: `listmonk_clone_campaign`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `write:campaign`
- Policy: confirmation `never`, audit `required`, dry-run `false`
- Retry: `unsafe`
- Stability: `experimental` since `0.9.0`

## `templates.create`

Create a template in Listmonk

- Resource / verb: `template.create`
- MCP tool: `listmonk_create_template`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `write:template`
- Policy: confirmation `never`, audit `required`, dry-run `false`
- Retry: `unsafe`
- Stability: `experimental` since `0.9.0`

## `templates.update`

Update a template in Listmonk

- Resource / verb: `template.update`
- MCP tool: `listmonk_update_template`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `write:template`
- Policy: confirmation `never`, audit `required`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`

## `templates.delete`

Delete a template from Listmonk

- Resource / verb: `template.delete`
- MCP tool: `listmonk_delete_template`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `delete:template`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`

## `templates.set-default`

Set a template as the Listmonk default

- Resource / verb: `template.set-default`
- MCP tool: `listmonk_set_default_template`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `write:template`
- Policy: confirmation `never`, audit `required`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`

## `media.delete`

Delete an uploaded media file from Listmonk

- Resource / verb: `media.delete`
- MCP tool: `listmonk_delete_media`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `delete:media`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`

## `media.upload`

Upload a media file to Listmonk from base64-encoded contents. Validates an allowlist of MIME types and a 10 MiB size cap before sending.

- Resource / verb: `media.upload`
- MCP tool: `listmonk_upload_media`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `write:media`
- Policy: confirmation `never`, audit `required`, dry-run `false`
- Retry: `unsafe`
- Stability: `experimental` since `0.9.0`

## `ops.campaign.deliverability-guard`

Evaluate campaign deliverability metrics and optionally pause a breached campaign

- Resource / verb: `campaign.deliverability-guard`
- MCP tool: `listmonk_ops_deliverability_guard`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `read:campaign, write:campaign`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`

## `ops.subscribers.hygiene`

Run the winback or sunset subscriber hygiene workflow

- Resource / verb: `subscriber.hygiene`
- MCP tool: `listmonk_ops_subscriber_hygiene`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `write:subscriber, suppression:audience`
- Policy: confirmation `required`, audit `required`, dry-run `true`
- Retry: `unsafe`
- Stability: `experimental` since `0.9.0`

## `ops.segments.drift`

Snapshot list sizes and detect subscriber-count drift

- Resource / verb: `audience.drift`
- MCP tool: `listmonk_ops_segment_drift`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `maintenance:recover:recoverable`
- Policy: confirmation `never`, audit `required`, dry-run `false`
- Retry: `unsafe`
- Stability: `experimental` since `0.9.0`

## `ops.templates.registry-sync`

Capture Listmonk templates in the local version registry

- Resource / verb: `template.registry-sync`
- MCP tool: `listmonk_ops_template_registry_sync`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `write:template`
- Policy: confirmation `never`, audit `required`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`

## `ops.templates.registry-history`

Read stored template versions from the local registry

- Resource / verb: `template.registry-history`
- MCP tool: `listmonk_ops_template_registry_history`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `read:template`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`

## `ops.templates.registry-promote`

Promote a stored template version to active Listmonk content

- Resource / verb: `template.registry-promote`
- MCP tool: `listmonk_ops_template_registry_promote`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `write:template`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `unsafe`
- Stability: `experimental` since `0.9.0`

## `ops.templates.registry-rollback`

Rollback a Listmonk template to its previous stored version

- Resource / verb: `template.registry-rollback`
- MCP tool: `listmonk_ops_template_registry_rollback`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `write:template`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `unsafe`
- Stability: `experimental` since `0.9.0`

## `ops.digest.daily`

Generate a metrics and deliverability summary for an operations window

- Resource / verb: `control.daily`
- MCP tool: `listmonk_ops_daily_digest`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `read:control`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`

## `abtest.list`

List persisted A/B tests, optionally filtered by status

- Resource / verb: `experiment.list`
- MCP tool: `listmonk_abtest_list`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `read:experiment`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`

## `abtest.get`

Get persisted A/B test details

- Resource / verb: `experiment.get`
- MCP tool: `listmonk_abtest_get`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `read:experiment`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`

## `abtest.create`

Create and persist an A/B test; auto-launch can start its campaigns

- Resource / verb: `experiment.create`
- MCP tool: `listmonk_abtest_create`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `write:experiment, write:campaign, write:list, delivery:bulk:scheduled`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `unsafe`
- Stability: `experimental` since `0.9.0`

## `abtest.analyze`

Analyze persisted A/B test statistical results

- Resource / verb: `experiment.analyze`
- MCP tool: `listmonk_abtest_analyze`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `read:experiment`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`

## `abtest.launch`

Launch a draft A/B test

- Resource / verb: `experiment.launch`
- MCP tool: `listmonk_abtest_launch`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `write:experiment, delivery:bulk:scheduled`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `unsafe`
- Stability: `experimental` since `0.9.0`

## `abtest.stop`

Stop an A/B test and clean up its non-terminal Listmonk campaigns and temporary lists

- Resource / verb: `experiment.stop`
- MCP tool: `listmonk_abtest_stop`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `write:experiment, delete:campaign, delete:list`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `unsafe`
- Stability: `experimental` since `0.9.0`

## `abtest.delete`

Delete an A/B test and clean up non-terminal Listmonk campaigns and temporary lists before removing persisted state

- Resource / verb: `experiment.delete`
- MCP tool: `listmonk_abtest_delete`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `delete:experiment, delete:campaign, delete:list`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`

## `abtest.recommend-sample-size`

Get statistical recommendations for test-group sample size

- Resource / verb: `experiment.recommend-sample-size`
- MCP tool: `listmonk_abtest_recommend_sample_size`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `read:experiment`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`

## `abtest.deploy-winner`

Deploy a statistically significant winner to the holdout group

- Resource / verb: `experiment.deploy-winner`
- MCP tool: `listmonk_abtest_deploy_winner`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `write:experiment, write:campaign, delivery:bulk:immediate`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `unsafe`
- Stability: `experimental` since `0.9.0`

## `abtest.run`

Advance a single A/B test one lifecycle step based on its current status

- Resource / verb: `experiment.run`
- MCP tool: `listmonk_abtest_run`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `write:experiment, write:campaign, delivery:bulk:immediate`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `unsafe`
- Stability: `experimental` since `0.9.0`

## `abtest.tick`

Advance every non-terminal A/B test one lifecycle step and report the actions taken

- Resource / verb: `experiment.tick`
- MCP tool: `listmonk_abtest_tick`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `write:experiment, write:campaign, delivery:bulk:immediate`
- Policy: confirmation `required`, audit `required`, dry-run `true`
- Retry: `unsafe`
- Stability: `experimental` since `0.9.0`

## `abtest.reconcile`

Reconcile persisted A/B test state against expected lifecycle state; repairs are destructive when enabled

- Resource / verb: `experiment.reconcile`
- MCP tool: `listmonk_abtest_reconcile`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `maintenance:resolve:destructive`
- Policy: confirmation `required`, audit `required`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`

## `abtest.export-assignment`

Export the subscriber assignment manifest for a test with deterministic provisioning. Contains subscriber group assignments (no email/PII).

- Resource / verb: `experiment.export-assignment`
- MCP tool: `listmonk_abtest_export_assignment`
- Contract source: input `runtime-operation`, output `runtime-operation`
- Effects: `read:experiment`
- Policy: confirmation `never`, audit `optional`, dry-run `false`
- Retry: `safe`
- Stability: `experimental` since `0.9.0`
