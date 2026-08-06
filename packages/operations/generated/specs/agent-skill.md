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

Contract maturity: `experimental`; effects: `read:control`; confirmation: `never`; retry: `safe`.

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

Contract maturity: `experimental`; effects: `write:webhook`; confirmation: `never`; retry: `reconcile`.

Use when: A new signed outbound event destination must be registered.

Avoid when: The signing secret value would need to be stored in the request.

Prerequisites: none

Verify with: `webhooks.list`

Retry guidance: List endpoints by name after an ambiguous result before creating again.

## Update outbound webhook endpoint (`webhooks.update`)

Contract maturity: `experimental`; effects: `write:webhook`; confirmation: `never`; retry: `safe`.

Use when: An existing endpoint configuration or enabled state must change.

Avoid when: A delivery attempt rather than endpoint configuration must change.

Prerequisites: `webhooks.list`

Verify with: `webhooks.list`

Retry guidance: Retrying the same field update is safe.

## Delete outbound webhook endpoint (`webhooks.delete`)

Contract maturity: `experimental`; effects: `delete:webhook`; confirmation: `required`; retry: `reconcile`.

Use when: An endpoint must be permanently removed and pending work abandoned.

Avoid when: Temporarily stopping deliveries is sufficient; disable the endpoint instead.

Prerequisites: `webhooks.list`

Verify with: `webhooks.list`, `webhooks.delivery.list`

Retry guidance: List endpoints after an ambiguous result; do not blindly repeat deletion.

## Send outbound webhook test (`webhooks.test`)

Contract maturity: `experimental`; effects: `webhook:single`; confirmation: `required`; retry: `unsafe`.

Use when: A configured endpoint and signing secret must be verified end to end.

Avoid when: The endpoint owner has not approved an external test request.

Prerequisites: `webhooks.list`

Verify with: `webhooks.delivery.list`

Retry guidance: Inspect the delivery log and endpoint system before sending another test.

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

Retry guidance: Inspect the delivery status after an ambiguous result before requeueing again.

## Reconcile outbound webhook leases (`webhooks.reconcile`)

Contract maturity: `experimental`; effects: `maintenance:recover:recoverable`; confirmation: `never`; retry: `reconcile`.

Use when: A worker may have crashed with deliveries left in the delivering state.

Avoid when: Healthy non-expired workers are still processing the selected leases.

Prerequisites: `webhooks.delivery.list`

Verify with: `webhooks.delivery.list`

Retry guidance: Re-run in dry-run mode after an ambiguous result to verify whether more expired deliveries remain before retrying.

## Prune outbound webhook delivery history (`webhooks.prune`)

Contract maturity: `experimental`; effects: `maintenance:prune:destructive`; confirmation: `required`; retry: `safe`.

Use when: Terminal delivery history has exceeded the retention policy.

Avoid when: Delivery records are still pending, retrying, or delivering.

Prerequisites: `webhooks.delivery.list`

Verify with: `webhooks.delivery.list`

Retry guidance: Run dry_run first; repeating the confirmed cutoff is safe.

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

Contract maturity: `experimental`; effects: `write:webhook`; confirmation: `never`; retry: `safe`.

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

Retry guidance: Run dry_run first and list dead letters after an ambiguous replay.

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

Contract maturity: `experimental`; effects: `write:sequence`; confirmation: `never`; retry: `unsafe`.

Use when: A validated sequence definition must be persisted.

Avoid when: An existing sequence should receive a new revision.

Prerequisites: `sequences.validate`

Verify with: `sequences.get`

Retry guidance: Inspect sequences.list before retrying an ambiguous create.

## Create sequence revision (`sequences.update`)

Contract maturity: `experimental`; effects: `write:sequence`; confirmation: `never`; retry: `unsafe`.

Use when: Future enrollments need a revised sequence definition.

Avoid when: Running enrollments should be mutated in place.

Prerequisites: `sequences.get`, `sequences.validate`

Verify with: `sequences.get`

Retry guidance: Read the current revision before retrying an ambiguous update.

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

Contract maturity: `experimental`; effects: `delete:sequence`; confirmation: `required`; retry: `unsafe`.

Use when: A retired sequence with no active enrollments must be removed.

Avoid when: Any enrollment is pending, running, waiting, or paused.

Prerequisites: `sequences.get`, `sequences.status`

Verify with: `sequences.list`

Retry guidance: List sequences before retrying a response-lost delete.

## Enroll subscriber in sequence (`sequences.enroll`)

Contract maturity: `experimental`; effects: `delivery:single:scheduled`; confirmation: `never`; retry: `reconcile`.

Use when: A known subscriber should enter a reviewed active sequence.

Avoid when: The sequence is paused or subscriber consent is uncertain.

Prerequisites: `sequences.get`

Verify with: `sequences.status`

Retry guidance: Inspect sequence state before retrying enrollment.

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

Contract maturity: `experimental`; effects: `write:template`; confirmation: `required`; retry: `reconcile`.

Use when: A versioned template manifest must be planned or applied.

Avoid when: A single template should be inspected without a full manifest.

Prerequisites: `templates.list`

Verify with: `templates.list`

Retry guidance: Re-run reconcile in dry-run mode after a partial apply to verify the remaining desired state before applying again.

## Create subscriber list (`lists.create`)

Contract maturity: `experimental`; effects: `write:list`; confirmation: `never`; retry: `unsafe`.

Use when: Create a new subscriber list

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: none

Verify with: `lists.list`

Retry guidance: Do not automatically retry an ambiguous failure; inspect the target resource or reconcile first.

## Update subscriber list (`lists.update`)

Contract maturity: `experimental`; effects: `write:list`; confirmation: `required`; retry: `safe`.

Use when: Update an existing subscriber list

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: `lists.get`

Verify with: `lists.get`

Retry guidance: Retry identical transient failures with bounded backoff.

## Delete subscriber list (`lists.delete`)

Contract maturity: `experimental`; effects: `delete:list`; confirmation: `required`; retry: `safe`.

Use when: Delete a subscriber list

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: `lists.get`

Verify with: `lists.list`

Retry guidance: Retry identical transient failures with bounded backoff.

## Create subscriber (`subscribers.create`)

Contract maturity: `experimental`; effects: `write:subscriber`; confirmation: `never`; retry: `unsafe`.

Use when: Create a subscriber in Listmonk

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: none

Verify with: `subscribers.list`

Retry guidance: Do not automatically retry an ambiguous failure; inspect the target resource or reconcile first.

## Update subscriber (`subscribers.update`)

Contract maturity: `experimental`; effects: `write:subscriber`; confirmation: `never`; retry: `safe`.

Use when: Update a subscriber in Listmonk

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: `subscribers.get`

Verify with: `subscribers.get`

Retry guidance: Retry identical transient failures with bounded backoff.

## Delete subscriber (`subscribers.delete`)

Contract maturity: `experimental`; effects: `delete:subscriber`; confirmation: `required`; retry: `safe`.

Use when: Delete a subscriber from Listmonk

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: `subscribers.get`

Verify with: `subscribers.list`

Retry guidance: Retry identical transient failures with bounded backoff.

## Add subscribers to lists (`subscribers.add-to-lists`)

Contract maturity: `experimental`; effects: `write:subscriber`; confirmation: `never`; retry: `safe`.

Use when: Add a batch of subscribers to one or more lists. Processes subscribers in chunks and supports dry-run, max-items cap, and continue-on-error.

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: `subscribers.get`, `lists.get`

Verify with: `subscribers.get`

Retry guidance: Retry identical transient failures with bounded backoff.

## Remove subscribers from lists (`subscribers.remove-from-lists`)

Contract maturity: `experimental`; effects: `write:subscriber`; confirmation: `required`; retry: `safe`.

Use when: Remove a batch of subscribers from one or more lists. Processes subscribers in chunks and supports dry-run, max-items cap, and continue-on-error. Destructive because re-adding subscribers does not guarantee their previous per-list subscription state is reconstructed.

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: `subscribers.get`, `lists.get`

Verify with: `subscribers.get`

Retry guidance: Retry identical transient failures with bounded backoff.

## Unblocklist subscribers (`subscribers.unblocklist`)

Contract maturity: `experimental`; effects: `write:subscriber`; confirmation: `never`; retry: `safe`.

Use when: Remove a batch of subscribers from the blocklist. Processes subscribers in chunks and supports dry-run, max-items cap, and continue-on-error.

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: `subscribers.get`

Verify with: `subscribers.get`

Retry guidance: Retry identical transient failures with bounded backoff.

## Create campaign (`campaigns.create`)

Contract maturity: `experimental`; effects: `write:campaign`; confirmation: `never`; retry: `unsafe`.

Use when: Create a campaign in Listmonk

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: none

Verify with: `campaigns.list`

Retry guidance: Do not automatically retry an ambiguous failure; inspect the target resource or reconcile first.

## Update campaign (`campaigns.update`)

Contract maturity: `experimental`; effects: `write:campaign`; confirmation: `never`; retry: `safe`.

Use when: Update a campaign in Listmonk

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: `campaigns.get`

Verify with: `campaigns.get`

Retry guidance: Retry identical transient failures with bounded backoff.

## Delete campaign (`campaigns.delete`)

Contract maturity: `experimental`; effects: `delete:campaign`; confirmation: `required`; retry: `safe`.

Use when: Delete a campaign from Listmonk

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: `campaigns.get`

Verify with: `campaigns.list`

Retry guidance: Retry identical transient failures with bounded backoff.

## Pause campaign (`campaigns.pause`)

Contract maturity: `experimental`; effects: `write:campaign`; confirmation: `never`; retry: `safe`.

Use when: Transition a campaign into the paused status. Validates the current status allows the transition.

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: `campaigns.get`

Verify with: `campaigns.get`

Retry guidance: Retry identical transient failures with bounded backoff.

## Clone campaign (`campaigns.clone`)

Contract maturity: `experimental`; effects: `write:campaign`; confirmation: `never`; retry: `unsafe`.

Use when: Create a new campaign by copying the body, lists, template, and metadata of an existing campaign under a new name. The clone starts in draft status.

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: `campaigns.get`

Verify with: `campaigns.list`

Retry guidance: Do not automatically retry an ambiguous failure; inspect the target resource or reconcile first.

## Create template (`templates.create`)

Contract maturity: `experimental`; effects: `write:template`; confirmation: `never`; retry: `unsafe`.

Use when: Create a template in Listmonk

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: none

Verify with: `templates.list`

Retry guidance: Do not automatically retry an ambiguous failure; inspect the target resource or reconcile first.

## Update template (`templates.update`)

Contract maturity: `experimental`; effects: `write:template`; confirmation: `never`; retry: `safe`.

Use when: Update a template in Listmonk

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: `templates.get`

Verify with: `templates.get`

Retry guidance: Retry identical transient failures with bounded backoff.

## Delete template (`templates.delete`)

Contract maturity: `experimental`; effects: `delete:template`; confirmation: `required`; retry: `safe`.

Use when: Delete a template from Listmonk

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: `templates.get`

Verify with: `templates.list`

Retry guidance: Retry identical transient failures with bounded backoff.

## Set default template (`templates.set-default`)

Contract maturity: `experimental`; effects: `write:template`; confirmation: `never`; retry: `safe`.

Use when: Set a template as the Listmonk default

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: `templates.get`

Verify with: `templates.get`

Retry guidance: Retry identical transient failures with bounded backoff.

## Delete media file (`media.delete`)

Contract maturity: `experimental`; effects: `delete:media`; confirmation: `required`; retry: `safe`.

Use when: Delete an uploaded media file from Listmonk

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: `media.get`

Verify with: `media.list`

Retry guidance: Retry identical transient failures with bounded backoff.

## Upload media file (`media.upload`)

Contract maturity: `experimental`; effects: `write:media`; confirmation: `never`; retry: `unsafe`.

Use when: Upload a media file to Listmonk from base64-encoded contents. Validates an allowlist of MIME types and a 10 MiB size cap before sending.

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: none

Verify with: `media.list`

Retry guidance: Do not automatically retry an ambiguous failure; inspect the target resource or reconcile first.

## Evaluate deliverability guard (`ops.campaign.deliverability-guard`)

Contract maturity: `experimental`; effects: `read:campaign, write:campaign`; confirmation: `required`; retry: `safe`.

Use when: Evaluate campaign deliverability metrics and optionally pause a breached campaign

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: `campaigns.get`, `campaigns.stats`

Verify with: `campaigns.get`, `campaigns.stats`

Retry guidance: Retry identical transient failures with bounded backoff.

## Run subscriber hygiene (`ops.subscribers.hygiene`)

Contract maturity: `experimental`; effects: `write:subscriber, suppression:audience`; confirmation: `required`; retry: `unsafe`.

Use when: Run the winback or sunset subscriber hygiene workflow

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: `subscribers.list`

Verify with: `subscribers.list`

Retry guidance: Do not automatically retry an ambiguous failure; inspect the target resource or reconcile first.

## Detect segment drift (`ops.segments.drift`)

Contract maturity: `experimental`; effects: `maintenance:recover:recoverable`; confirmation: `never`; retry: `unsafe`.

Use when: Snapshot list sizes and detect subscriber-count drift

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: `lists.list`

Verify with: `lists.list`

Retry guidance: Do not automatically retry an ambiguous failure; inspect the target resource or reconcile first.

## Sync template registry (`ops.templates.registry-sync`)

Contract maturity: `experimental`; effects: `write:template`; confirmation: `never`; retry: `safe`.

Use when: Capture Listmonk templates in the local version registry

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: `templates.list`

Verify with: `ops.templates.registry-history`

Retry guidance: Retry identical transient failures with bounded backoff.

## Read template registry history (`ops.templates.registry-history`)

Contract maturity: `experimental`; effects: `read:template`; confirmation: `never`; retry: `safe`.

Use when: Read stored template versions from the local registry

Avoid when: A mutation or workflow transition is required instead of inspection.

Prerequisites: none

Verify with: none

Retry guidance: Retry identical transient failures with bounded backoff.

## Promote template version (`ops.templates.registry-promote`)

Contract maturity: `experimental`; effects: `write:template`; confirmation: `required`; retry: `unsafe`.

Use when: Promote a stored template version to active Listmonk content

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: `ops.templates.registry-history`, `templates.get`

Verify with: `templates.get`, `ops.templates.registry-history`

Retry guidance: Do not automatically retry an ambiguous failure; inspect the target resource or reconcile first.

## Rollback template version (`ops.templates.registry-rollback`)

Contract maturity: `experimental`; effects: `write:template`; confirmation: `required`; retry: `unsafe`.

Use when: Rollback a Listmonk template to its previous stored version

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: `ops.templates.registry-history`, `templates.get`

Verify with: `templates.get`, `ops.templates.registry-history`

Retry guidance: Do not automatically retry an ambiguous failure; inspect the target resource or reconcile first.

## Generate daily operations digest (`ops.digest.daily`)

Contract maturity: `experimental`; effects: `read:control`; confirmation: `never`; retry: `safe`.

Use when: Generate a metrics and deliverability summary for an operations window

Avoid when: A mutation or workflow transition is required instead of inspection.

Prerequisites: none

Verify with: none

Retry guidance: Retry identical transient failures with bounded backoff.

## List A/B tests (`abtest.list`)

Contract maturity: `experimental`; effects: `read:experiment`; confirmation: `never`; retry: `safe`.

Use when: List persisted A/B tests, optionally filtered by status

Avoid when: A mutation or workflow transition is required instead of inspection.

Prerequisites: none

Verify with: none

Retry guidance: Retry identical transient failures with bounded backoff.

## Get A/B test (`abtest.get`)

Contract maturity: `experimental`; effects: `read:experiment`; confirmation: `never`; retry: `safe`.

Use when: Get persisted A/B test details

Avoid when: A mutation or workflow transition is required instead of inspection.

Prerequisites: none

Verify with: none

Retry guidance: Retry identical transient failures with bounded backoff.

## Create A/B test (`abtest.create`)

Contract maturity: `experimental`; effects: `write:experiment, write:campaign, write:list, delivery:bulk:scheduled`; confirmation: `required`; retry: `unsafe`.

Use when: Create and persist an A/B test; auto-launch can start its campaigns

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: none

Verify with: `abtest.get`

Retry guidance: Do not automatically retry an ambiguous failure; inspect the target resource or reconcile first.

## Analyze A/B test (`abtest.analyze`)

Contract maturity: `experimental`; effects: `read:experiment`; confirmation: `never`; retry: `safe`.

Use when: Analyze persisted A/B test statistical results

Avoid when: A mutation or workflow transition is required instead of inspection.

Prerequisites: `abtest.get`

Verify with: none

Retry guidance: Retry identical transient failures with bounded backoff.

## Launch A/B test (`abtest.launch`)

Contract maturity: `experimental`; effects: `write:experiment, delivery:bulk:scheduled`; confirmation: `required`; retry: `unsafe`.

Use when: Launch a draft A/B test

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: `abtest.get`, `ops.campaign.preflight`

Verify with: `abtest.get`

Retry guidance: Do not automatically retry an ambiguous failure; inspect the target resource or reconcile first.

## Stop A/B test (`abtest.stop`)

Contract maturity: `experimental`; effects: `write:experiment, delete:campaign, delete:list`; confirmation: `required`; retry: `unsafe`.

Use when: Stop an A/B test and clean up its non-terminal Listmonk campaigns and temporary lists

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: `abtest.get`

Verify with: `abtest.get`

Retry guidance: Do not automatically retry an ambiguous failure; inspect the target resource or reconcile first.

## Delete A/B test (`abtest.delete`)

Contract maturity: `experimental`; effects: `delete:experiment, delete:campaign, delete:list`; confirmation: `required`; retry: `safe`.

Use when: Delete an A/B test and clean up non-terminal Listmonk campaigns and temporary lists before removing persisted state

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: `abtest.get`

Verify with: `abtest.list`

Retry guidance: Retry identical transient failures with bounded backoff.

## Recommend A/B test sample size (`abtest.recommend-sample-size`)

Contract maturity: `experimental`; effects: `read:experiment`; confirmation: `never`; retry: `safe`.

Use when: Get statistical recommendations for test-group sample size

Avoid when: A mutation or workflow transition is required instead of inspection.

Prerequisites: none

Verify with: none

Retry guidance: Retry identical transient failures with bounded backoff.

## Deploy A/B test winner (`abtest.deploy-winner`)

Contract maturity: `experimental`; effects: `write:experiment, write:campaign, delivery:bulk:immediate`; confirmation: `required`; retry: `unsafe`.

Use when: Deploy a statistically significant winner to the holdout group

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: `abtest.get`, `abtest.analyze`

Verify with: `abtest.get`

Retry guidance: Do not automatically retry an ambiguous failure; inspect the target resource or reconcile first.

## Run A/B test step (`abtest.run`)

Contract maturity: `experimental`; effects: `write:experiment, write:campaign, delivery:bulk:immediate`; confirmation: `required`; retry: `unsafe`.

Use when: Advance a single A/B test one lifecycle step based on its current status

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: `abtest.get`

Verify with: `abtest.get`

Retry guidance: Do not automatically retry an ambiguous failure; inspect the target resource or reconcile first.

## Tick A/B tests (`abtest.tick`)

Contract maturity: `experimental`; effects: `write:experiment, write:campaign, delivery:bulk:immediate`; confirmation: `required`; retry: `unsafe`.

Use when: Advance every non-terminal A/B test one lifecycle step and report the actions taken

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: `abtest.list`

Verify with: `abtest.list`

Retry guidance: Do not automatically retry an ambiguous failure; inspect the target resource or reconcile first.

## Reconcile A/B test state (`abtest.reconcile`)

Contract maturity: `experimental`; effects: `maintenance:resolve:destructive`; confirmation: `required`; retry: `safe`.

Use when: Reconcile persisted A/B test state against expected lifecycle state; repairs are destructive when enabled

Avoid when: The target, intended side effect, or required confirmation has not been verified.

Prerequisites: `abtest.get`

Verify with: `abtest.get`

Retry guidance: Retry identical transient failures with bounded backoff.

## Export A/B test assignment manifest (`abtest.export-assignment`)

Contract maturity: `experimental`; effects: `read:experiment`; confirmation: `never`; retry: `safe`.

Use when: Export the subscriber assignment manifest for a test with deterministic provisioning. Contains subscriber group assignments (no email/PII).

Avoid when: A mutation or workflow transition is required instead of inspection.

Prerequisites: `abtest.get`

Verify with: none

Retry guidance: Retry identical transient failures with bounded backoff.

## Reconcile user-role manifest (`user-roles.reconcile`)

Contract maturity: `experimental`; effects: `write:user-role`; confirmation: `required`; retry: `reconcile`.

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
