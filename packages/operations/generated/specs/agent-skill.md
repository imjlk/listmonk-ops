# listmonk-ops agent operation reference

> Generated from the Email Operations Specification. Runtime safety gates and explicit confirmation remain authoritative.

## Get campaign (`campaigns.get`)

Contract maturity: `stable`; effects: `read:campaign`; confirmation: `never`; retry: `safe`.

Use when: A campaign must be inspected before a mutation or verification.

Avoid when: A campaign collection or aggregate statistics are required.

Prerequisites: none

Verify with: none

Retry guidance: Retry transient read failures with normal backoff.

## Schedule campaign (`campaigns.schedule`)

Contract maturity: `stable`; effects: `delivery:bulk:scheduled`; confirmation: `required`; retry: `reconcile`.

Use when: A reviewed campaign must start bulk delivery at a future time.

Avoid when: The campaign is already running or terminal. Campaign preflight has not passed.

Prerequisites: `campaigns.get`, `ops.campaign.preflight`

Verify with: `campaigns.get`

Retry guidance: On timeout, inspect campaigns.get before deciding whether to retry.

## Blocklist subscribers (`subscribers.blocklist`)

Contract maturity: `stable`; effects: `suppression:audience`; confirmation: `required`; retry: `safe`.

Use when: One or more subscribers must be prevented from receiving future mail.

Avoid when: The target audience has not been previewed with dry_run. A per-list unsubscribe is intended instead of global suppression.

Prerequisites: `subscribers.get`

Verify with: `subscribers.get`

Retry guidance: Prefer dry_run first; an identical confirmed retry is safe after transient failure.

## Start campaign (`campaigns.start`)

Contract maturity: `stable`; effects: `delivery:bulk:immediate`; confirmation: `required`; retry: `reconcile`.

Use when: A reviewed campaign must begin bulk delivery immediately.

Avoid when: Campaign preflight has not passed. The campaign should begin at a future time instead of immediately.

Prerequisites: `campaigns.get`, `ops.campaign.preflight`

Verify with: `campaigns.get`, `campaigns.stats`

Retry guidance: On timeout, inspect campaigns.get before repeating the confirmed start.

## Cancel campaign (`campaigns.cancel`)

Contract maturity: `stable`; effects: `write:campaign`; confirmation: `required`; retry: `reconcile`.

Use when: An actively sending campaign must be stopped permanently.

Avoid when: A temporary pause is sufficient. The campaign is scheduled but has not started; Listmonk only cancels active campaigns.

Prerequisites: `campaigns.get`

Verify with: `campaigns.get`

Retry guidance: On timeout, inspect campaigns.get before repeating the confirmed cancellation.

## Send transactional message (`transactional.send`)

Contract maturity: `stable`; effects: `delivery:single:immediate`; confirmation: `never`; retry: `conditional`.

Use when: One transactional template must be sent to exactly one recipient.

Avoid when: A campaign or sequence is the correct delivery mechanism. A retryable workflow cannot provide a stable idempotency_key.

Prerequisites: none

Verify with: none

Retry guidance: Always provide a stable idempotency_key for agent retries; reconcile pending or unknown records instead of changing the key.

## Run campaign preflight (`ops.campaign.preflight`)

Contract maturity: `stable`; effects: `read:campaign`; confirmation: `never`; retry: `safe`.

Use when: A campaign must be checked immediately before scheduling or starting delivery.

Avoid when: The campaign does not yet have its final audience, content, sender, and delivery profile.

Prerequisites: `campaigns.get`

Verify with: none

Retry guidance: Retry transient reads or public-link probes; re-evaluate the returned checks because remote state may have changed.

## Search operation specs (`specs.search`)

Contract maturity: `stable`; effects: `read:spec`; confirmation: `never`; retry: `safe`.

Use when: The agent knows an operational intent but not the exact operation or MCP tool name.

Avoid when: The exact operation ID is already known and its complete contract is required.

Prerequisites: none

Verify with: none

Retry guidance: Retrying the same catalog search is safe.

## Describe operation spec (`specs.describe`)

Contract maturity: `stable`; effects: `read:spec`; confirmation: `never`; retry: `safe`.

Use when: The exact operation ID or MCP tool name is known and the full contract must be inspected before execution.

Avoid when: The agent is still searching for the correct operation.

Prerequisites: none

Verify with: none

Retry guidance: Retrying the same catalog lookup is safe.

## List operation playbooks (`playbooks.list`)

Contract maturity: `stable`; effects: `read:playbook`; confirmation: `never`; retry: `safe`.

Use when: The agent needs a predefined safe workflow instead of composing raw operations.

Avoid when: A single exact operation is sufficient for the requested task.

Prerequisites: none

Verify with: none

Retry guidance: Retrying the same playbook listing is safe.

## Get operation playbook (`playbooks.get`)

Contract maturity: `stable`; effects: `read:playbook`; confirmation: `never`; retry: `safe`.

Use when: A known playbook must be inspected before executing any of its steps.

Avoid when: The agent has not yet selected a playbook.

Prerequisites: `playbooks.list`

Verify with: none

Retry guidance: Retrying the same playbook lookup is safe.

## Get control-plane capabilities (`control.capabilities`)

Contract maturity: `stable`; effects: `read:control`; confirmation: `never`; retry: `safe`.

Use when: The agent must discover the breadth and typed coverage of the current listmonk-ops installation.

Avoid when: Live Listmonk connectivity is the only readiness question.

Prerequisites: none

Verify with: none

Retry guidance: Retrying the same capability inspection is safe.

## Prime an operations agent (`control.prime`)

Contract maturity: `stable`; effects: `read:control`; confirmation: `never`; retry: `safe`.

Use when: An agent is beginning an email operations task and needs a compact, goal-oriented starting context.

Avoid when: The exact operation contract is already known.

Prerequisites: none

Verify with: `control.status`

Retry guidance: Retrying the same prime request is safe.

## Get control-plane status (`control.status`)

Contract maturity: `stable`; effects: `read:control`; confirmation: `never`; retry: `safe`.

Use when: The agent must confirm the current surface and Listmonk target are ready before operational work.

Avoid when: Only static catalog capabilities are required.

Prerequisites: none

Verify with: none

Retry guidance: Retry transient health failures with normal backoff; do not infer authentication from reachability alone.

## List outbound webhook endpoints (`webhooks.list`)

Contract maturity: `stable`; effects: `read:webhook`; confirmation: `never`; retry: `safe`.

Use when: Configured webhook endpoints or their filters must be inspected.

Avoid when: Delivery attempts rather than endpoint configuration are needed.

Prerequisites: none

Verify with: none

Retry guidance: Retrying the same read is safe.

## Create outbound webhook endpoint (`webhooks.create`)

Contract maturity: `stable`; effects: `write:webhook`; confirmation: `never`; retry: `reconcile`.

Use when: A new signed outbound event destination must be registered.

Avoid when: The signing secret value would need to be stored in the request.

Prerequisites: none

Verify with: `webhooks.list`

Retry guidance: Replay the create after an ambiguous result: an identically configured endpoint returns the persisted record with created: false, while a conflicting configuration under the same name fails explicitly.

## Update outbound webhook endpoint (`webhooks.update`)

Contract maturity: `stable`; effects: `write:webhook`; confirmation: `never`; retry: `safe`.

Use when: An existing endpoint configuration or enabled state must change.

Avoid when: A delivery attempt rather than endpoint configuration must change.

Prerequisites: `webhooks.list`

Verify with: `webhooks.list`

Retry guidance: Retrying the same field update is safe.

## Delete outbound webhook endpoint (`webhooks.delete`)

Contract maturity: `stable`; effects: `delete:webhook`; confirmation: `required`; retry: `reconcile`.

Use when: An endpoint must be permanently removed and pending work abandoned.

Avoid when: Temporarily stopping deliveries is sufficient; disable the endpoint instead.

Prerequisites: `webhooks.list`

Verify with: `webhooks.list`, `webhooks.delivery.list`

Retry guidance: Verify the endpoint is gone with webhooks.list before retrying; an already-deleted endpoint reports deleted: false without error.

## Send outbound webhook test (`webhooks.test`)

Contract maturity: `experimental`; effects: `webhook:single`; confirmation: `required`; retry: `unsafe`.

Use when: A configured endpoint and signing secret must be verified end to end.

Avoid when: The endpoint owner has not approved an external test request.

Prerequisites: `webhooks.list`

Verify with: `webhooks.delivery.list`

Retry guidance: Key the probe with a correlation_id so an ambiguous retry collapses onto the queued delivery, and inspect webhooks.delivery.list before repeating — a retry or expired lease whose first attempt reached the endpoint can redeliver the ping.

## Dispatch outbound webhooks (`webhooks.dispatch`)

Contract maturity: `experimental`; effects: `webhook:bulk`; confirmation: `required`; retry: `reconcile`.

Use when: Due outbox deliveries should be processed by a worker or scheduled tick.

Avoid when: The operator has not approved external network delivery.

Prerequisites: `webhooks.list`

Verify with: `webhooks.delivery.list`

Retry guidance: Inspect delivery statuses after a timeout and rely on stable event IDs for receiver deduplication.

## List outbound webhook deliveries (`webhooks.delivery.list`)

Contract maturity: `stable`; effects: `read:webhook`; confirmation: `never`; retry: `safe`.

Use when: Delivery progress, retries, or exhausted events must be inspected.

Avoid when: Endpoint configuration rather than delivery state is needed.

Prerequisites: none

Verify with: none

Retry guidance: Retrying the same read is safe.

## Retry outbound webhook delivery (`webhooks.delivery.retry`)

Contract maturity: `experimental`; effects: `write:webhook`; confirmation: `required`; retry: `reconcile`.

Use when: An operator has reviewed a failed delivery and wants another attempt cycle.

Avoid when: The endpoint is disabled, missing, or the failure has not been investigated.

Prerequisites: `webhooks.delivery.list`

Verify with: `webhooks.delivery.list`

Retry guidance: Verify the delivery with webhooks.delivery.list before repeating an ambiguous retry; a repeat while the delivery is still pending reports retried: false, but a completed dispatch can make the repeat start another cycle.

## Reconcile outbound webhook leases (`webhooks.reconcile`)

Contract maturity: `experimental`; effects: `maintenance:recover:recoverable`; confirmation: `never`; retry: `reconcile`.

Use when: A worker may have crashed with deliveries left in the delivering state.

Avoid when: Healthy non-expired workers are still processing the selected leases.

Prerequisites: `webhooks.delivery.list`

Verify with: `webhooks.delivery.list`

Retry guidance: Re-run in dry-run mode after an ambiguous result to verify whether more expired deliveries remain before retrying.

## Prune outbound webhook delivery history (`webhooks.prune`)

Contract maturity: `stable`; effects: `maintenance:prune:destructive`; confirmation: `required`; retry: `safe`.

Use when: Terminal delivery history has exceeded the retention policy.

Avoid when: Delivery records are still pending, retrying, or delivering.

Prerequisites: `webhooks.delivery.list`

Verify with: `webhooks.delivery.list`

Retry guidance: Run dry_run first, then echo the reported ids and before cutoff; repeating that exact request deletes nothing new.

## Run one outbound webhook worker tick (`webhooks.tick`)

Contract maturity: `experimental`; effects: `webhook:bulk`; confirmation: `required`; retry: `reconcile`.

Use when: A scheduler or operator should process one durable outbox batch.

Avoid when: External webhook delivery has not been approved.

Prerequisites: `webhooks.list`

Verify with: `webhooks.delivery.list`

Retry guidance: Inspect delivery state after a timeout before running another tick.

## Inspect outbound webhook runtime health (`webhooks.runtime.status`)

Contract maturity: `stable`; effects: `read:webhook`; confirmation: `never`; retry: `safe`.

Use when: Worker readiness, circuit state, or outbox backlog must be inspected.

Avoid when: A specific delivery payload rather than aggregate health is needed.

Prerequisites: none

Verify with: none

Retry guidance: Retrying the same health read is safe.

## Ingest normalized provider delivery event (`webhooks.inbound.ingest`)

Contract maturity: `stable`; effects: `write:webhook`; confirmation: `never`; retry: `safe`.

Use when: A verified provider event must enter the shared event stream.

Avoid when: The raw provider payload has not been authenticated or normalized. An unsubscribe event cannot be resolved to a subscriber UUID.

Prerequisites: none

Verify with: `webhooks.delivery.list`

Retry guidance: Retry with the same provider and provider_event_id; ingestion is idempotent.

## List outbound webhook dead letters (`webhooks.dlq.list`)

Contract maturity: `stable`; effects: `read:webhook`; confirmation: `never`; retry: `safe`.

Use when: Exhausted deliveries must be reviewed before replay.

Avoid when: Active retry or pending delivery state is needed.

Prerequisites: none

Verify with: none

Retry guidance: Retrying the same read is safe.

## Replay outbound webhook dead letters (`webhooks.dlq.replay`)

Contract maturity: `experimental`; effects: `maintenance:replay:destructive`; confirmation: `required`; retry: `reconcile`.

Use when: Reviewed dead letters should receive a fresh bounded attempt cycle.

Avoid when: The endpoint remains unhealthy or its circuit remains open.

Prerequisites: `webhooks.dlq.list`, `webhooks.runtime.status`

Verify with: `webhooks.delivery.list`

Retry guidance: Run dry_run first, then echo the reported delivery_ids; an identical repeat replays nothing new unless a worker re-exhausted a replayed record, so inspect webhooks.dlq.list before repeating.

## Reset outbound webhook circuit breaker (`webhooks.circuit.reset`)

Contract maturity: `stable`; effects: `write:webhook`; confirmation: `required`; retry: `safe`.

Use when: An endpoint failure has been fixed and delivery may resume.

Avoid when: The endpoint has not been tested or remains unhealthy.

Prerequisites: `webhooks.runtime.status`, `webhooks.test`

Verify with: `webhooks.runtime.status`

Retry guidance: Retrying the same reset is safe.

## Validate sequence definition (`sequences.validate`)

Contract maturity: `stable`; effects: `read:sequence`; confirmation: `never`; retry: `safe`.

Use when: A sequence definition must be checked before it is created or updated.

Avoid when: The sequence has already been validated and persistence is required.

Prerequisites: none

Verify with: none

Retry guidance: Retrying validation is safe.

## Create sequence (`sequences.create`)

Contract maturity: `stable`; effects: `write:sequence`; confirmation: `never`; retry: `reconcile`.

Use when: A validated sequence definition must be persisted.

Avoid when: An existing sequence should receive a new revision.

Prerequisites: `sequences.validate`

Verify with: `sequences.get`

Retry guidance: Replay the create after an ambiguous result: an identically defined sequence returns the persisted record with created: false, while a conflicting definition under the same name fails explicitly.

## Create sequence revision (`sequences.update`)

Contract maturity: `stable`; effects: `write:sequence`; confirmation: `never`; retry: `conditional`.

Use when: Future enrollments need a revised sequence definition.

Avoid when: Running enrollments should be mutated in place.

Prerequisites: `sequences.get`, `sequences.validate`

Verify with: `sequences.get`

Retry guidance: Verify the latest revision with sequences.get before repeating an ambiguous update; an identical repeat reports updated: false without a new revision.

## List sequences (`sequences.list`)

Contract maturity: `stable`; effects: `read:sequence`; confirmation: `never`; retry: `safe`.

Use when: Available sequences or their paused state must be discovered.

Avoid when: One known sequence must be inspected.

Prerequisites: none

Verify with: none

Retry guidance: Retrying the same read is safe.

## Get sequence (`sequences.get`)

Contract maturity: `stable`; effects: `read:sequence`; confirmation: `never`; retry: `safe`.

Use when: A known sequence and its revision history must be inspected.

Avoid when: The sequence ID is unknown.

Prerequisites: none

Verify with: none

Retry guidance: Retrying the same read is safe.

## Delete sequence (`sequences.delete`)

Contract maturity: `stable`; effects: `delete:sequence`; confirmation: `required`; retry: `reconcile`.

Use when: A retired sequence with no active enrollments must be removed.

Avoid when: Any enrollment is pending, running, waiting, or paused.

Prerequisites: `sequences.get`, `sequences.status`

Verify with: `sequences.list`

Retry guidance: Verify the sequence is gone with sequences.list before retrying; an already-deleted sequence reports deleted: false without error.

## Enroll subscriber in sequence (`sequences.enroll`)

Contract maturity: `experimental`; effects: `delivery:single:scheduled`; confirmation: `never`; retry: `reconcile`.

Use when: A known subscriber should enter a reviewed active sequence.

Avoid when: The sequence is paused or subscriber consent is uncertain.

Prerequisites: `sequences.get`

Verify with: `sequences.status`

Retry guidance: Verify the enrollment with sequences.enrollments.list before repeating an ambiguous enroll; an untouched identical one replays with created: false, but a terminal enrollment lets the repeat start a fresh lifecycle.

## List sequence enrollments (`sequences.enrollments.list`)

Contract maturity: `stable`; effects: `read:sequence`; confirmation: `never`; retry: `safe`.

Use when: Enrollment IDs or runtime outcomes must be discovered.

Avoid when: Only aggregate runtime health is required.

Prerequisites: none

Verify with: none

Retry guidance: Retrying the same enrollment query is safe.

## Get sequence enrollment (`sequences.enrollments.get`)

Contract maturity: `stable`; effects: `read:sequence`; confirmation: `never`; retry: `safe`.

Use when: A known enrollment needs detailed inspection or reconciliation.

Avoid when: The enrollment ID is unknown.

Prerequisites: none

Verify with: none

Retry guidance: Retrying the same enrollment read is safe.

## Pause sequence (`sequences.pause`)

Contract maturity: `stable`; effects: `write:sequence`; confirmation: `never`; retry: `safe`.

Use when: Sequence execution must stop claiming new due enrollments.

Avoid when: An individual ambiguous send needs reconciliation.

Prerequisites: `sequences.get`

Verify with: `sequences.get`

Retry guidance: Retrying the same pause is safe.

## Resume sequence (`sequences.resume`)

Contract maturity: `stable`; effects: `write:sequence`; confirmation: `never`; retry: `safe`.

Use when: A reviewed paused sequence may continue processing.

Avoid when: The cause of the pause remains unresolved.

Prerequisites: `sequences.get`, `sequences.status`

Verify with: `sequences.get`

Retry guidance: Retrying the same resume is safe.

## Run sequence worker tick (`sequences.tick`)

Contract maturity: `experimental`; effects: `delivery:bulk:immediate`; confirmation: `required`; retry: `reconcile`.

Use when: Due sequence enrollments should execute in a bounded batch.

Avoid when: Runtime health is degraded or ambiguous sends are unresolved.

Prerequisites: `sequences.status`

Verify with: `sequences.status`

Retry guidance: Run reconcile and inspect status before retrying a failed tick.

## Reconcile sequence runtime (`sequences.reconcile`)

Contract maturity: `experimental`; effects: `maintenance:recover:recoverable, maintenance:resolve:destructive`; confirmation: `required`; retry: `reconcile`.

Use when: Expired leases or an operator-reviewed ambiguous send need recovery.

Avoid when: The delivery outcome of an ambiguous send is still unknown.

Prerequisites: `sequences.status`

Verify with: `sequences.status`

Retry guidance: Inspect sequences.status before retrying; ambiguous-send resolution is not idempotent.

## Inspect sequence runtime health (`sequences.status`)

Contract maturity: `stable`; effects: `read:sequence`; confirmation: `never`; retry: `safe`.

Use when: Sequence worker readiness or stalled work must be inspected.

Avoid when: A sequence definition rather than runtime health is needed.

Prerequisites: none

Verify with: none

Retry guidance: Retrying the same status read is safe.

## List provider profiles (`providers.list`)

Contract maturity: `stable`; effects: `read:provider`; confirmation: `never`; retry: `safe`.

Use when: The agent must discover configured delivery provider IDs before running diagnostics.

Avoid when: The provider ID is already known.

Prerequisites: none

Verify with: none

Retry guidance: Retry after the provider configuration file becomes readable or valid.

## Inspect provider status (`providers.status`)

Contract maturity: `stable`; effects: `read:provider`; confirmation: `never`; retry: `safe`.

Use when: The agent needs a structured provider and Listmonk readiness snapshot.

Avoid when: Only raw SES quota values or DNS records are required.

Prerequisites: `providers.list`

Verify with: none

Retry guidance: Retry transient Listmonk or provider failures with normal backoff.

## Test provider API access (`providers.test`)

Contract maturity: `stable`; effects: `read:provider`; confirmation: `never`; retry: `safe`.

Use when: Provider credentials or API reachability must be checked without sending a message.

Avoid when: An actual mailbox delivery or SMTP transaction test is required.

Prerequisites: `providers.list`

Verify with: none

Retry guidance: Retry throttling and transient network failures with bounded backoff.

## Inspect provider sending quota (`providers.quota`)

Contract maturity: `stable`; effects: `read:provider`; confirmation: `never`; retry: `safe`.

Use when: An audience or sequence send must be compared with current provider capacity.

Avoid when: The provider has no supported quota adapter.

Prerequisites: `providers.list`

Verify with: none

Retry guidance: Retry transient provider failures; do not assume cached quotas remain current.

## Inspect provider webhook status (`providers.webhook-status`)

Contract maturity: `stable`; effects: `read:provider`; confirmation: `never`; retry: `safe`.

Use when: Bounce or complaint feedback configuration and recent evidence must be checked.

Avoid when: A missing event is being treated as proof of failure without first running a provider simulator test.

Prerequisites: `providers.list`

Verify with: none

Retry guidance: Retry Listmonk read failures; an unknown freshness result requires a simulator test rather than blind retries.

## Check provider DNS (`deliverability.dns-check`)

Contract maturity: `stable`; effects: `read:provider`; confirmation: `never`; retry: `safe`.

Use when: The agent must verify public authentication records for a configured sending identity.

Avoid when: The agent intends to mutate DNS or infer propagation from one failed lookup.

Prerequisites: `providers.list`

Verify with: none

Retry guidance: Retry transient resolver failures after normal DNS propagation delay; this operation never changes records.

## Run deliverability doctor (`deliverability.doctor`)

Contract maturity: `stable`; effects: `read:provider`; confirmation: `never`; retry: `safe`.

Use when: An agent must determine whether a provider profile is ready before scheduling or launching email.

Avoid when: The caller expects the operation to repair provider, DNS, or Listmonk configuration automatically.

Prerequisites: `providers.list`

Verify with: none

Retry guidance: Retry transient reads; fix reported failures explicitly and rerun the doctor before delivery.

## List subscriber lists (`lists.list`)

Contract maturity: `stable`; effects: `read:list`; confirmation: `never`; retry: `safe`.

Use when: Subscriber lists must be discovered or enumerated.

Avoid when: A specific subscriber list is already known by ID.

Prerequisites: none

Verify with: none

Retry guidance: Retry transient read failures with bounded backoff.

## Get subscriber list (`lists.get`)

Contract maturity: `stable`; effects: `read:list`; confirmation: `never`; retry: `safe`.

Use when: A subscriber list must be inspected by its numeric ID.

Avoid when: The subscriber-list ID is not known and discovery is required.

Prerequisites: none

Verify with: none

Retry guidance: Retry transient read failures with bounded backoff.

## List subscribers (`subscribers.list`)

Contract maturity: `stable`; effects: `read:subscriber`; confirmation: `never`; retry: `safe`.

Use when: Subscribers must be searched, filtered, or enumerated.

Avoid when: A specific subscriber is already known by ID.

Prerequisites: none

Verify with: none

Retry guidance: Retry transient read failures with bounded backoff.

## Get subscriber (`subscribers.get`)

Contract maturity: `stable`; effects: `read:subscriber`; confirmation: `never`; retry: `safe`.

Use when: A subscriber must be inspected by its numeric ID.

Avoid when: The subscriber ID is not known and discovery is required.

Prerequisites: none

Verify with: none

Retry guidance: Retry transient read failures with bounded backoff.

## List campaigns (`campaigns.list`)

Contract maturity: `stable`; effects: `read:campaign`; confirmation: `never`; retry: `safe`.

Use when: Campaigns must be searched, filtered, or enumerated.

Avoid when: A specific campaign is already known by ID.

Prerequisites: none

Verify with: none

Retry guidance: Retry transient read failures with bounded backoff.

## Get campaign stats (`campaigns.stats`)

Contract maturity: `stable`; effects: `read:campaign`; confirmation: `never`; retry: `safe`.

Use when: Delivery statistics for a campaign must be inspected.

Avoid when: The full campaign representation or collection is required.

Prerequisites: `campaigns.get`

Verify with: none

Retry guidance: Retry transient read failures with bounded backoff.

## List templates (`templates.list`)

Contract maturity: `stable`; effects: `read:template`; confirmation: `never`; retry: `safe`.

Use when: Templates must be discovered or enumerated.

Avoid when: A specific template is already known by ID.

Prerequisites: none

Verify with: none

Retry guidance: Retry transient read failures with bounded backoff.

## Get template (`templates.get`)

Contract maturity: `stable`; effects: `read:template`; confirmation: `never`; retry: `safe`.

Use when: A template must be inspected by its numeric ID.

Avoid when: The template ID is not known and discovery is required.

Prerequisites: none

Verify with: none

Retry guidance: Retry transient read failures with bounded backoff.

## List media (`media.list`)

Contract maturity: `stable`; effects: `read:media`; confirmation: `never`; retry: `safe`.

Use when: Uploaded media files must be discovered or enumerated.

Avoid when: A specific media file is already known by ID.

Prerequisites: none

Verify with: none

Retry guidance: Retry transient read failures with bounded backoff.

## Get media file (`media.get`)

Contract maturity: `stable`; effects: `read:media`; confirmation: `never`; retry: `safe`.

Use when: An uploaded media file must be inspected by its numeric ID.

Avoid when: The media-file ID is not known and discovery is required.

Prerequisites: none

Verify with: none

Retry guidance: Retry transient read failures with bounded backoff.

## Reconcile template manifest (`templates.reconcile`)

Contract maturity: `stable`; effects: `write:template`; confirmation: `required`; retry: `reconcile`.

Use when: A versioned template manifest must be planned or applied.

Avoid when: A single template should be inspected without a full manifest.

Prerequisites: `templates.list`

Verify with: `templates.list`

Retry guidance: Re-run reconcile in dry-run mode after a partial apply to verify the remaining desired state before applying again.

## Create template (`templates.create`)

Contract maturity: `experimental`; effects: `write:template`; confirmation: `never`; retry: `unsafe`.

Use when: A new Listmonk template must be created.

Avoid when: An existing template should be converged by exact name; use templates.reconcile instead.

Prerequisites: none

Verify with: `templates.list`

Retry guidance: Do not automatically retry an ambiguous failure; inspect templates.list for the intended name first.

## Update template (`templates.update`)

Contract maturity: `stable`; effects: `write:template`; confirmation: `never`; retry: `safe`.

Use when: A known template must be updated by numeric ID.

Avoid when: The template ID is unknown or a versioned exact-name manifest should be reconciled.

Prerequisites: `templates.get`

Verify with: `templates.get`

Retry guidance: Retry identical transient failures with bounded backoff, then verify with templates.get.

## Delete template (`templates.delete`)

Contract maturity: `stable`; effects: `delete:template`; confirmation: `required`; retry: `reconcile`.

Use when: A verified template must be permanently deleted.

Avoid when: The template ID or destructive confirmation has not been verified.

Prerequisites: `templates.get`

Verify with: `templates.list`

Retry guidance: Verify the template is gone with templates.list before retrying; an already-deleted template reports deleted: false without error.

## Set default template (`templates.set-default`)

Contract maturity: `stable`; effects: `write:template`; confirmation: `never`; retry: `safe`.

Use when: A verified template should become the Listmonk default.

Avoid when: The template ID has not been verified.

Prerequisites: `templates.get`

Verify with: `templates.get`

Retry guidance: Retry identical transient failures with bounded backoff, then verify with templates.get.

## Create subscriber list (`lists.create`)

Contract maturity: `experimental`; effects: `write:list`; confirmation: `never`; retry: `unsafe`.

Use when: A new subscriber list must be created.

Avoid when: An existing list should be updated instead.

Prerequisites: none

Verify with: `lists.list`

Retry guidance: Inspect lists.list before retrying an ambiguous create.

## Update subscriber list (`lists.update`)

Contract maturity: `stable`; effects: `write:list`; confirmation: `never`; retry: `safe`.

Use when: A known subscriber list must be updated by numeric ID.

Avoid when: The list ID is unknown.

Prerequisites: `lists.get`

Verify with: `lists.get`

Retry guidance: Retry identical transient failures with bounded backoff, then verify with lists.get.

## Delete subscriber list (`lists.delete`)

Contract maturity: `stable`; effects: `delete:list`; confirmation: `required`; retry: `reconcile`.

Use when: A subscriber list must be permanently removed.

Avoid when: The list still has active subscribers or campaigns.

Prerequisites: `lists.get`

Verify with: `lists.list`

Retry guidance: Verify the list is gone with lists.list before retrying.

## Create subscriber (`subscribers.create`)

Contract maturity: `stable`; effects: `write:subscriber`; confirmation: `never`; retry: `reconcile`.

Use when: A new subscriber must be created.

Avoid when: An existing subscriber should be updated instead.

Prerequisites: none

Verify with: `subscribers.list`

Retry guidance: Verify the subscriber with subscribers.list before repeating an ambiguous create; an identical retry replays it with created: false.

## Update subscriber (`subscribers.update`)

Contract maturity: `stable`; effects: `write:subscriber`; confirmation: `never`; retry: `safe`.

Use when: A known subscriber must be updated by numeric ID.

Avoid when: The subscriber ID is unknown.

Prerequisites: `subscribers.get`

Verify with: `subscribers.get`

Retry guidance: Retry identical transient failures with bounded backoff, then verify with subscribers.get.

## Delete subscriber (`subscribers.delete`)

Contract maturity: `stable`; effects: `delete:subscriber`; confirmation: `required`; retry: `reconcile`.

Use when: A subscriber must be permanently removed.

Avoid when: The subscriber should be blocklisted instead.

Prerequisites: `subscribers.get`

Verify with: `subscribers.list`

Retry guidance: Verify the subscriber is gone with subscribers.list before retrying.

## Add subscribers to lists (`subscribers.add-to-lists`)

Contract maturity: `stable`; effects: `write:subscriber`; confirmation: `never`; retry: `safe`.

Use when: Subscribers must be added to one or more lists in bulk.

Avoid when: The subscribers or lists are not known.

Prerequisites: `subscribers.get`, `lists.get`

Verify with: `subscribers.get`

Retry guidance: Retry identical transient failures with bounded backoff.

## Remove subscribers from lists (`subscribers.remove-from-lists`)

Contract maturity: `stable`; effects: `write:subscriber`; confirmation: `required`; retry: `safe`.

Use when: Subscribers must be removed from one or more lists in bulk.

Avoid when: The subscribers or lists are not known.

Prerequisites: `subscribers.get`, `lists.get`

Verify with: `subscribers.get`

Retry guidance: Retry identical transient failures with bounded backoff.

## Unblocklist subscribers (`subscribers.unblocklist`)

Contract maturity: `stable`; effects: `write:subscriber`; confirmation: `never`; retry: `safe`.

Use when: Subscribers must be removed from the blocklist in bulk.

Avoid when: The subscriber IDs are not known.

Prerequisites: `subscribers.get`

Verify with: `subscribers.get`

Retry guidance: Retry identical transient failures with bounded backoff.

## Create campaign (`campaigns.create`)

Contract maturity: `experimental`; effects: `write:campaign`; confirmation: `never`; retry: `unsafe`.

Use when: A new campaign must be created.

Avoid when: An existing campaign should be cloned or updated instead.

Prerequisites: none

Verify with: `campaigns.list`

Retry guidance: Inspect campaigns.list before retrying an ambiguous create.

## Update campaign (`campaigns.update`)

Contract maturity: `stable`; effects: `write:campaign`; confirmation: `never`; retry: `safe`.

Use when: A known campaign must be updated by numeric ID.

Avoid when: The campaign ID is unknown.

Prerequisites: `campaigns.get`

Verify with: `campaigns.get`

Retry guidance: Retry identical transient failures with bounded backoff, then verify with campaigns.get.

## Delete campaign (`campaigns.delete`)

Contract maturity: `stable`; effects: `delete:campaign`; confirmation: `required`; retry: `reconcile`.

Use when: A campaign must be permanently removed.

Avoid when: The campaign is running or scheduled.

Prerequisites: `campaigns.get`

Verify with: `campaigns.list`

Retry guidance: Verify the campaign is gone with campaigns.list before retrying.

## Pause campaign (`campaigns.pause`)

Contract maturity: `stable`; effects: `write:campaign`; confirmation: `never`; retry: `safe`.

Use when: A running campaign must be paused.

Avoid when: The campaign is already paused or in a terminal status.

Prerequisites: `campaigns.get`

Verify with: `campaigns.get`

Retry guidance: Retry identical transient failures with bounded backoff, then verify with campaigns.get.

## Clone campaign (`campaigns.clone`)

Contract maturity: `experimental`; effects: `write:campaign`; confirmation: `never`; retry: `unsafe`.

Use when: A new campaign should reuse an existing campaign's content.

Avoid when: A brand-new campaign should be created from scratch.

Prerequisites: `campaigns.get`

Verify with: `campaigns.list`

Retry guidance: Inspect campaigns.list before retrying an ambiguous clone.

## Delete media file (`media.delete`)

Contract maturity: `stable`; effects: `delete:media`; confirmation: `required`; retry: `reconcile`.

Use when: A media file must be permanently removed.

Avoid when: The media file is referenced by a campaign or template.

Prerequisites: `media.get`

Verify with: `media.list`

Retry guidance: Verify the file is gone with media.list before retrying.

## Upload media file (`media.upload`)

Contract maturity: `experimental`; effects: `write:media`; confirmation: `never`; retry: `unsafe`.

Use when: A new media file must be uploaded.

Avoid when: An existing media file should be referenced instead.

Prerequisites: none

Verify with: `media.list`

Retry guidance: Inspect media.list before retrying an ambiguous upload.

## Detect segment drift (`ops.segments.drift`)

Contract maturity: `stable`; effects: `maintenance:recover:recoverable`; confirmation: `never`; retry: `conditional`.

Use when: Subscriber list sizes must be monitored for unexpected drift.

Avoid when: No subscriber lists exist to monitor.

Prerequisites: `lists.list`

Verify with: `lists.list`

Retry guidance: For an unkeyed run, verify the prior snapshot was committed before re-running; an ambiguous retry appends a fresh sample that double-weights the period. For a keyed run, re-run with the same sample_key: the retry replaces that period's snapshot instead of appending a duplicate sample.

## Generate daily operations digest (`ops.digest.daily`)

Contract maturity: `stable`; effects: `read:control`; confirmation: `never`; retry: `safe`.

Use when: An operations digest must be generated for a time window.

Avoid when: The time window has no campaign or subscriber activity.

Prerequisites: none

Verify with: none

Retry guidance: Retry is safe; the digest is read-only.

## Evaluate deliverability guard (`ops.campaign.deliverability-guard`)

Contract maturity: `stable`; effects: `read:campaign, write:campaign`; confirmation: `required`; retry: `safe`.

Use when: Campaign deliverability metrics must be evaluated against thresholds.

Avoid when: The campaign has not started sending yet.

Prerequisites: none

Verify with: `campaigns.get`

Retry guidance: Retry is safe; the guard re-reads current metrics.

## Run subscriber hygiene (`ops.subscribers.hygiene`)

Contract maturity: `stable`; effects: `write:subscriber, suppression:audience`; confirmation: `required`; retry: `reconcile`.

Use when: Inactive subscribers must be identified for winback or sunset workflows.

Avoid when: No subscriber inactivity baseline has been established.

Prerequisites: `subscribers.list`

Verify with: `subscribers.list`

Retry guidance: Run dry_run first, then echo the reported subscriber_ids; repeating the same destructive request processes nothing new — left-set subscribers are skipped and list additions are idempotent memberships.

## Sync template registry (`ops.templates.registry-sync`)

Contract maturity: `stable`; effects: `write:template`; confirmation: `never`; retry: `safe`.

Use when: Listmonk templates must be captured into the local version registry.

Avoid when: No templates have changed since the last sync.

Prerequisites: `templates.list`

Verify with: `ops.templates.registry-history`

Retry guidance: Retry is safe; unchanged templates are skipped.

## Show template version history (`ops.templates.registry-history`)

Contract maturity: `stable`; effects: `read:template`; confirmation: `never`; retry: `safe`.

Use when: A template's stored version history must be inspected.

Avoid when: The template has not been synced into the registry.

Prerequisites: `ops.templates.registry-sync`

Verify with: none

Retry guidance: Retry transient read failures with bounded backoff.

## Promote template version (`ops.templates.registry-promote`)

Contract maturity: `experimental`; effects: `write:template`; confirmation: `required`; retry: `safe`.

Use when: A previously captured template version must be restored to Listmonk.

Avoid when: The target version is already the active remote template.

Prerequisites: `ops.templates.registry-history`

Verify with: `templates.get`

Retry guidance: Retry is safe; the promotion is idempotent for the same version content.

## Rollback template version (`ops.templates.registry-rollback`)

Contract maturity: `experimental`; effects: `write:template`; confirmation: `required`; retry: `unsafe`.

Use when: A template must be reverted to its previous stored version.

Avoid when: No previous version exists in the registry.

Prerequisites: `ops.templates.registry-history`

Verify with: `templates.get`

Retry guidance: Pin the target with to_version_id from ops.templates.registry-history before retrying an ambiguous rollback, and inspect templates.get and the registry history for intervening promotes; a pinned repeat conflicts when the registry moved to a different previous version.

## List A/B tests (`abtest.list`)

Contract maturity: `stable`; effects: `read:experiment`; confirmation: `never`; retry: `safe`.

Use when: A/B tests must be discovered or enumerated.

Avoid when: A specific test ID is already known.

Prerequisites: none

Verify with: none

Retry guidance: Retry transient read failures with bounded backoff.

## Get A/B test (`abtest.get`)

Contract maturity: `stable`; effects: `read:experiment`; confirmation: `never`; retry: `safe`.

Use when: A specific A/B test must be inspected by ID.

Avoid when: The test ID is unknown.

Prerequisites: none

Verify with: none

Retry guidance: Retry transient read failures with bounded backoff.

## Create A/B test (`abtest.create`)

Contract maturity: `experimental`; effects: `write:experiment, write:campaign, delivery:bulk:scheduled`; confirmation: `required`; retry: `unsafe`.

Use when: A new A/B test must be created.

Avoid when: An existing test should be updated.

Prerequisites: none

Verify with: `abtest.get`

Retry guidance: Verify the test with abtest.get before repeating an ambiguous create; an identical retry resumes an unfinished intent or replays a completed one, and the remote campaigns and lists should be inspected for duplicates.

## Analyze A/B test (`abtest.analyze`)

Contract maturity: `stable`; effects: `read:experiment`; confirmation: `never`; retry: `safe`.

Use when: A/B test results must be statistically evaluated.

Avoid when: The test has not started or has insufficient data.

Prerequisites: `abtest.get`

Verify with: none

Retry guidance: Retry is safe; the analysis is read-only.

## Launch A/B test (`abtest.launch`)

Contract maturity: `stable`; effects: `write:experiment, write:campaign, delivery:bulk:scheduled`; confirmation: `required`; retry: `reconcile`.

Use when: A draft A/B test is ready to go live.

Avoid when: The test has validation errors.

Prerequisites: `abtest.get`

Verify with: `abtest.get`

Retry guidance: Verify the launch with abtest.get before retrying; a recorded launch repeats as a no-op that returns the persisted test.

## Stop A/B test (`abtest.stop`)

Contract maturity: `stable`; effects: `write:experiment, write:campaign, delete:campaign, delete:list`; confirmation: `required`; retry: `reconcile`.

Use when: A running or scheduled A/B test must be stopped.

Avoid when: The test has already reached a terminal status.

Prerequisites: `abtest.get`

Verify with: `abtest.get`

Retry guidance: Verify the stop with abtest.get before retrying; a completed stop repeats as a no-op and remote cleanup skips already-removed resources.

## Delete A/B test (`abtest.delete`)

Contract maturity: `stable`; effects: `delete:experiment, delete:campaign, delete:list`; confirmation: `required`; retry: `reconcile`.

Use when: An A/B test must be permanently removed.

Avoid when: The test is still running.

Prerequisites: `abtest.get`

Verify with: `abtest.list`

Retry guidance: Verify the test is gone with abtest.list before retrying; a completed repeat reports deleted: false and skips already-removed remote resources.

## Recommend A/B test sample size (`abtest.recommend-sample-size`)

Contract maturity: `stable`; effects: `read:experiment`; confirmation: `never`; retry: `safe`.

Use when: A sample size recommendation is needed before creating a test.

Avoid when: The list sizes are unknown.

Prerequisites: `lists.list`

Verify with: none

Retry guidance: Retry is safe; the recommendation is read-only.

## Deploy A/B test winner (`abtest.deploy-winner`)

Contract maturity: `experimental`; effects: `write:experiment, delivery:bulk:immediate`; confirmation: `required`; retry: `unsafe`.

Use when: A winning variant must be deployed to the holdout group.

Avoid when: No statistically significant winner has been identified.

Prerequisites: `abtest.analyze`

Verify with: `abtest.get`

Retry guidance: Inspect abtest.get and the holdout campaign before retrying; an ambiguous deployment may already have delivered to the holdout audience.

## Run A/B test (`abtest.run`)

Contract maturity: `experimental`; effects: `write:experiment, delivery:bulk:immediate`; confirmation: `required`; retry: `unsafe`.

Use when: An A/B test must run through its lifecycle without manual steps.

Avoid when: The test requires manual review between stages.

Prerequisites: `abtest.get`

Verify with: `abtest.get`

Retry guidance: Inspect abtest.get before retrying an ambiguous run.

## Tick A/B tests (`abtest.tick`)

Contract maturity: `experimental`; effects: `write:experiment, delivery:bulk:immediate`; confirmation: `required`; retry: `unsafe`.

Use when: Non-terminal A/B tests must be advanced by one lifecycle step.

Avoid when: No tests are in a non-terminal status.

Prerequisites: `abtest.list`

Verify with: `abtest.list`

Retry guidance: Inspect abtest.list before retrying an ambiguous tick.

## Reconcile A/B test state (`abtest.reconcile`)

Contract maturity: `experimental`; effects: `write:experiment`; confirmation: `required`; retry: `unsafe`.

Use when: Persisted A/B test state must be checked or repaired.

Avoid when: No drift is suspected.

Prerequisites: `abtest.list`

Verify with: `abtest.list`

Retry guidance: Inspect abtest.list before retrying an ambiguous reconcile.

## Export A/B test assignment manifest (`abtest.export-assignment`)

Contract maturity: `stable`; effects: `read:experiment`; confirmation: `never`; retry: `safe`.

Use when: A deterministic assignment manifest must be exported.

Avoid when: The test was not provisioned with deterministic assignments.

Prerequisites: `abtest.get`

Verify with: none

Retry guidance: Retry is safe; the export is read-only.

## Reconcile user-role manifest (`user-roles.reconcile`)

Contract maturity: `stable`; effects: `write:user-role`; confirmation: `required`; retry: `reconcile`.

Use when: A versioned least-privilege user-role manifest must be planned or applied.

Avoid when: A single role should be inspected without a full manifest. The protected Super Admin role is the intended target.

Prerequisites: none

Verify with: none

Retry guidance: Re-run reconcile in dry-run mode after a partial apply to verify the remaining desired state before applying again.

# Typed playbooks

## `campaign.safe-start` — Safely start a campaign

Inspect and preflight a reviewed campaign, obtain human approval, start bulk delivery, and verify the resulting state.

Inputs:

- `campaign_id` (`number`, required): Listmonk campaign ID to start

Steps:

1. `inspect` → `campaigns.get` (none approval). Inspect the current campaign and its lifecycle status.
2. `preflight` → `ops.campaign.preflight` (none approval). Run pre-send checks against the final campaign. Guard: `summary.fail equals 0`; on failure: Do not start delivery while any preflight check fails.
3. `start` → `campaigns.start` (human approval). Begin bulk delivery after explicit human confirmation.
4. `verify` → `campaigns.get` (none approval). Verify that the campaign entered the running state. Guard: `status equals "running"`; on failure: Stop and reconcile the campaign state if running cannot be verified.

Recovery operation: `campaigns.get`

## `campaign.safe-schedule` — Safely schedule a campaign

Inspect and preflight a reviewed campaign, obtain human approval, schedule delivery, and verify the resulting state.

Inputs:

- `campaign_id` (`number`, required): Listmonk campaign ID to schedule
- `send_at` (`string`, required): Future delivery timestamp

Steps:

1. `inspect` → `campaigns.get` (none approval). Inspect the campaign and its current status.
2. `preflight` → `ops.campaign.preflight` (none approval). Run pre-send checks against the final campaign. Guard: `summary.fail equals 0`; on failure: Do not schedule while any preflight check fails.
3. `schedule` → `campaigns.schedule` (human approval). Schedule bulk delivery after explicit human confirmation.
4. `verify` → `campaigns.get` (none approval). Verify the campaign entered the scheduled state. Guard: `status equals "scheduled"`; on failure: Stop and reconcile if scheduling cannot be verified.

Recovery operation: `campaigns.get`

## `template.safe-promote` — Safely promote a template version

Inspect remote and stored template state, obtain human approval, promote an expected version, and verify the result.

Inputs:

- `template_id` (`number`, required): Listmonk template ID
- `version_id` (`string`, required): Stored registry version ID to promote

Steps:

1. `capture-remote` → `ops.templates.registry-sync` (none approval). Capture the current Listmonk template and its canonical content hash. Guard: `errors.length equals 0`; on failure: Do not promote when the remote template capture fails.
2. `inspect-history` → `ops.templates.registry-history` (none approval). Inspect stored template versions.
3. `promote` → `ops.templates.registry-promote` (human approval). Promote the selected version after explicit approval.
4. `verify` → `templates.get` (none approval). Re-read the remote template after promotion.

Recovery operation: `templates.get`

## `abtest.safe-run` — Safely advance one A/B test

Inspect an experiment, obtain human approval for its next lifecycle action, execute one step, and re-read persisted state.

Inputs:

- `test_id` (`string`, required): Persisted A/B test ID

Steps:

1. `inspect` → `abtest.get` (none approval). Inspect current experiment status and gates.
2. `run` → `abtest.run` (human approval). Advance exactly one lifecycle step after explicit approval.
3. `verify` → `abtest.get` (none approval). Read persisted experiment state after the action.

Recovery operation: `abtest.get`

## `campaign.deliverability-guard` — Guard campaign deliverability

Inspect a live campaign, evaluate deliverability metrics, pause on breach, and verify the resulting state.

Inputs:

- `campaign_id` (`number`, required): Listmonk campaign ID to guard

Steps:

1. `inspect` → `campaigns.get` (none approval). Inspect the campaign and its current status. Guard: `status equals "running"`; on failure: Only guard campaigns that are currently running.
2. `evaluate` → `ops.campaign.deliverability-guard` (human approval). Evaluate deliverability metrics and pause the campaign if thresholds are breached.
3. `verify` → `campaigns.get` (none approval). Verify the campaign state after the guard decision.

Recovery operation: `campaigns.get`

## `provider.health-check` — Check provider health

Inspect provider status, test API access, and verify DNS records without sending mail.

Inputs:

- `provider_id` (`string`, required): Configured provider profile ID

Steps:

1. `status` → `providers.status` (none approval). Inspect the provider configuration and credential status.
2. `api-test` → `providers.test` (none approval). Test provider API access without sending mail.
3. `dns-check` → `deliverability.dns-check` (none approval). Verify DMARC, DKIM, and custom MAIL FROM DNS records.

Recovery operation: `providers.status`

## `webhook.retention` — Prune terminal webhook delivery history

Preview the oldest terminal webhook deliveries past a retention window, then delete exactly the previewed set inside the previewed cutoff.

Inputs:

- `older_than_days` (`number`, required): Retention age in days for terminal delivery records

Steps:

1. `preview` → `webhooks.prune` (human approval). Preview the bounded oldest terminal batch past the retention window and capture its exact delivery ids and cutoff. Guard: `dry_run equals true`; on failure: The retention preview must stay a dry run.
2. `delete` → `webhooks.prune` (human approval). Delete exactly the previewed delivery ids inside the previewed cutoff; repeating the same request is a no-op.

Recovery operation: `webhooks.delivery.list`
