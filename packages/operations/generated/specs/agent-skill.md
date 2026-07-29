# listmonk-ops agent operation reference

> Generated from the Email Operations Specification. Runtime safety gates and explicit confirmation remain authoritative.

## Get campaign (`campaigns.get`)

Use when: A campaign must be inspected before a mutation or verification.

Avoid when: A campaign collection or aggregate statistics are required.

Prerequisites: none

Verify with: none

Retry guidance: Retry transient read failures with normal backoff.

## Schedule campaign (`campaigns.schedule`)

Use when: A reviewed campaign must start bulk delivery at a future time.

Avoid when: The campaign is already running or terminal. Campaign preflight has not passed.

Prerequisites: `campaigns.get`, `ops.campaign.preflight`

Verify with: `campaigns.get`

Retry guidance: On timeout, inspect campaigns.get before deciding whether to retry.

## Blocklist subscribers (`subscribers.blocklist`)

Use when: One or more subscribers must be prevented from receiving future mail.

Avoid when: The target audience has not been previewed with dry_run. A per-list unsubscribe is intended instead of global suppression.

Prerequisites: `subscribers.get`

Verify with: `subscribers.get`

Retry guidance: Prefer dry_run first; an identical confirmed retry is safe after transient failure.

## Start campaign (`campaigns.start`)

Use when: A reviewed campaign must begin bulk delivery immediately.

Avoid when: Campaign preflight has not passed. The campaign should begin at a future time instead of immediately.

Prerequisites: `campaigns.get`, `ops.campaign.preflight`

Verify with: `campaigns.get`, `campaigns.stats`

Retry guidance: On timeout, inspect campaigns.get before repeating the confirmed start.

## Cancel campaign (`campaigns.cancel`)

Use when: An actively sending campaign must be stopped permanently.

Avoid when: A temporary pause is sufficient. The campaign is scheduled but has not started; Listmonk only cancels active campaigns.

Prerequisites: `campaigns.get`

Verify with: `campaigns.get`

Retry guidance: On timeout, inspect campaigns.get before repeating the confirmed cancellation.

## Send transactional message (`transactional.send`)

Use when: One transactional template must be sent to exactly one recipient.

Avoid when: A campaign or sequence is the correct delivery mechanism. A retryable workflow cannot provide a stable idempotency_key.

Prerequisites: none

Verify with: none

Retry guidance: Always provide a stable idempotency_key for agent retries; reconcile pending or unknown records instead of changing the key.

## Run campaign preflight (`ops.campaign.preflight`)

Use when: A campaign must be checked immediately before scheduling or starting delivery.

Avoid when: The campaign does not yet have its final audience, content, sender, and delivery profile.

Prerequisites: `campaigns.get`

Verify with: none

Retry guidance: Retry transient reads or public-link probes; re-evaluate the returned checks because remote state may have changed.

## Search operation specs (`specs.search`)

Use when: The agent knows an operational intent but not the exact operation or MCP tool name.

Avoid when: The exact operation ID is already known and its complete contract is required.

Prerequisites: none

Verify with: none

Retry guidance: Retrying the same catalog search is safe.

## Describe operation spec (`specs.describe`)

Use when: The exact operation ID or MCP tool name is known and the full contract must be inspected before execution.

Avoid when: The agent is still searching for the correct operation.

Prerequisites: none

Verify with: none

Retry guidance: Retrying the same catalog lookup is safe.

## List operation playbooks (`playbooks.list`)

Use when: The agent needs a predefined safe workflow instead of composing raw operations.

Avoid when: A single exact operation is sufficient for the requested task.

Prerequisites: none

Verify with: none

Retry guidance: Retrying the same playbook listing is safe.

## Get operation playbook (`playbooks.get`)

Use when: A known playbook must be inspected before executing any of its steps.

Avoid when: The agent has not yet selected a playbook.

Prerequisites: `playbooks.list`

Verify with: none

Retry guidance: Retrying the same playbook lookup is safe.

## Get control-plane capabilities (`control.capabilities`)

Use when: The agent must discover the breadth and typed coverage of the current listmonk-ops installation.

Avoid when: Live Listmonk connectivity is the only readiness question.

Prerequisites: none

Verify with: none

Retry guidance: Retrying the same capability inspection is safe.

## Prime an operations agent (`control.prime`)

Use when: An agent is beginning an email operations task and needs a compact, goal-oriented starting context.

Avoid when: The exact operation contract is already known.

Prerequisites: none

Verify with: `control.status`

Retry guidance: Retrying the same prime request is safe.

## Get control-plane status (`control.status`)

Use when: The agent must confirm the current surface and Listmonk target are ready before operational work.

Avoid when: Only static catalog capabilities are required.

Prerequisites: none

Verify with: none

Retry guidance: Retry transient health failures with normal backoff; do not infer authentication from reachability alone.

## List outbound webhook endpoints (`webhooks.list`)

Use when: Configured webhook endpoints or their filters must be inspected.

Avoid when: Delivery attempts rather than endpoint configuration are needed.

Prerequisites: none

Verify with: none

Retry guidance: Retrying the same read is safe.

## Create outbound webhook endpoint (`webhooks.create`)

Use when: A new signed outbound event destination must be registered.

Avoid when: The signing secret value would need to be stored in the request.

Prerequisites: none

Verify with: `webhooks.list`

Retry guidance: List endpoints by name after an ambiguous result before creating again.

## Update outbound webhook endpoint (`webhooks.update`)

Use when: An existing endpoint configuration or enabled state must change.

Avoid when: A delivery attempt rather than endpoint configuration must change.

Prerequisites: `webhooks.list`

Verify with: `webhooks.list`

Retry guidance: Retrying the same field update is safe.

## Delete outbound webhook endpoint (`webhooks.delete`)

Use when: An endpoint must be permanently removed and pending work abandoned.

Avoid when: Temporarily stopping deliveries is sufficient; disable the endpoint instead.

Prerequisites: `webhooks.list`

Verify with: `webhooks.list`, `webhooks.delivery.list`

Retry guidance: List endpoints after an ambiguous result; do not blindly repeat deletion.

## Send outbound webhook test (`webhooks.test`)

Use when: A configured endpoint and signing secret must be verified end to end.

Avoid when: The endpoint owner has not approved an external test request.

Prerequisites: `webhooks.list`

Verify with: `webhooks.delivery.list`

Retry guidance: Inspect the delivery log and endpoint system before sending another test.

## Dispatch outbound webhooks (`webhooks.dispatch`)

Use when: Due outbox deliveries should be processed by a worker or scheduled tick.

Avoid when: The operator has not approved external network delivery.

Prerequisites: `webhooks.list`

Verify with: `webhooks.delivery.list`

Retry guidance: Inspect delivery statuses after a timeout and rely on stable event IDs for receiver deduplication.

## List outbound webhook deliveries (`webhooks.delivery.list`)

Use when: Delivery progress, retries, or exhausted events must be inspected.

Avoid when: Endpoint configuration rather than delivery state is needed.

Prerequisites: none

Verify with: none

Retry guidance: Retrying the same read is safe.

## Retry outbound webhook delivery (`webhooks.delivery.retry`)

Use when: An operator has reviewed a failed delivery and wants another attempt cycle.

Avoid when: The endpoint is disabled, missing, or the failure has not been investigated.

Prerequisites: `webhooks.delivery.list`

Verify with: `webhooks.delivery.list`

Retry guidance: Inspect the delivery status after an ambiguous result before requeueing again.

## Reconcile outbound webhook leases (`webhooks.reconcile`)

Use when: A worker may have crashed with deliveries left in the delivering state.

Avoid when: Healthy non-expired workers are still processing the selected leases.

Prerequisites: `webhooks.delivery.list`

Verify with: `webhooks.delivery.list`

Retry guidance: Repeating reconciliation is safe after an ambiguous result.

## Prune outbound webhook delivery history (`webhooks.prune`)

Use when: Terminal delivery history has exceeded the retention policy.

Avoid when: Delivery records are still pending, retrying, or delivering.

Prerequisites: `webhooks.delivery.list`

Verify with: `webhooks.delivery.list`

Retry guidance: Run dry_run first; repeating the confirmed cutoff is safe.

## Run one outbound webhook worker tick (`webhooks.tick`)

Use when: A scheduler or operator should process one durable outbox batch.

Avoid when: External webhook delivery has not been approved.

Prerequisites: `webhooks.list`

Verify with: `webhooks.delivery.list`

Retry guidance: Inspect delivery state after a timeout before running another tick.

## Inspect outbound webhook runtime health (`webhooks.runtime.status`)

Use when: Worker readiness, circuit state, or outbox backlog must be inspected.

Avoid when: A specific delivery payload rather than aggregate health is needed.

Prerequisites: none

Verify with: none

Retry guidance: Retrying the same health read is safe.

## Ingest normalized provider delivery event (`webhooks.inbound.ingest`)

Use when: A verified provider event must enter the shared event stream.

Avoid when: The raw provider payload has not been authenticated or normalized. An unsubscribe event cannot be resolved to a subscriber UUID.

Prerequisites: none

Verify with: `webhooks.delivery.list`

Retry guidance: Retry with the same provider and provider_event_id; ingestion is idempotent.

## List outbound webhook dead letters (`webhooks.dlq.list`)

Use when: Exhausted deliveries must be reviewed before replay.

Avoid when: Active retry or pending delivery state is needed.

Prerequisites: none

Verify with: none

Retry guidance: Retrying the same read is safe.

## Replay outbound webhook dead letters (`webhooks.dlq.replay`)

Use when: Reviewed dead letters should receive a fresh bounded attempt cycle.

Avoid when: The endpoint remains unhealthy or its circuit remains open.

Prerequisites: `webhooks.dlq.list`, `webhooks.runtime.status`

Verify with: `webhooks.delivery.list`

Retry guidance: Run dry_run first and list dead letters after an ambiguous replay.

## Reset outbound webhook circuit breaker (`webhooks.circuit.reset`)

Use when: An endpoint failure has been fixed and delivery may resume.

Avoid when: The endpoint has not been tested or remains unhealthy.

Prerequisites: `webhooks.runtime.status`, `webhooks.test`

Verify with: `webhooks.runtime.status`

Retry guidance: Retrying the same reset is safe.

## Validate sequence definition (`sequences.validate`)

Use when: A sequence definition must be checked before it is created or updated.

Avoid when: The sequence has already been validated and persistence is required.

Prerequisites: none

Verify with: none

Retry guidance: Retrying validation is safe.

## Create sequence (`sequences.create`)

Use when: A validated sequence definition must be persisted.

Avoid when: An existing sequence should receive a new revision.

Prerequisites: `sequences.validate`

Verify with: `sequences.get`

Retry guidance: Inspect sequences.list before retrying an ambiguous create.

## Create sequence revision (`sequences.update`)

Use when: Future enrollments need a revised sequence definition.

Avoid when: Running enrollments should be mutated in place.

Prerequisites: `sequences.get`, `sequences.validate`

Verify with: `sequences.get`

Retry guidance: Read the current revision before retrying an ambiguous update.

## List sequences (`sequences.list`)

Use when: Available sequences or their paused state must be discovered.

Avoid when: One known sequence requires full revision detail.

Prerequisites: none

Verify with: none

Retry guidance: Retrying the same read is safe.

## Get sequence (`sequences.get`)

Use when: A known sequence and its revision history must be inspected.

Avoid when: The sequence ID is unknown.

Prerequisites: none

Verify with: none

Retry guidance: Retrying the same read is safe.

## Delete sequence (`sequences.delete`)

Use when: A retired sequence with no active enrollments must be removed.

Avoid when: Any enrollment is pending, running, waiting, or paused.

Prerequisites: `sequences.get`, `sequences.status`

Verify with: `sequences.list`

Retry guidance: List sequences before retrying a response-lost delete.

## Enroll subscriber in sequence (`sequences.enroll`)

Use when: A known subscriber should enter a reviewed active sequence.

Avoid when: The sequence is paused or subscriber consent is uncertain.

Prerequisites: `sequences.get`

Verify with: `sequences.status`

Retry guidance: Inspect sequence state before retrying enrollment.

## List sequence enrollments (`sequences.enrollments.list`)

Use when: Enrollment IDs or runtime outcomes must be discovered.

Avoid when: Only aggregate runtime health is required.

Prerequisites: none

Verify with: none

Retry guidance: Retrying the same enrollment query is safe.

## Get sequence enrollment (`sequences.enrollments.get`)

Use when: A known enrollment needs detailed inspection or reconciliation.

Avoid when: The enrollment ID is unknown.

Prerequisites: none

Verify with: none

Retry guidance: Retrying the same enrollment read is safe.

## Pause sequence (`sequences.pause`)

Use when: Sequence execution must stop claiming new due enrollments.

Avoid when: An individual ambiguous send needs reconciliation.

Prerequisites: `sequences.get`

Verify with: `sequences.get`

Retry guidance: Retrying the same pause is safe.

## Resume sequence (`sequences.resume`)

Use when: A reviewed paused sequence may continue processing.

Avoid when: The cause of the pause remains unresolved.

Prerequisites: `sequences.get`, `sequences.status`

Verify with: `sequences.get`

Retry guidance: Retrying the same resume is safe.

## Run sequence worker tick (`sequences.tick`)

Use when: Due sequence enrollments should execute in a bounded batch.

Avoid when: Runtime health is degraded or ambiguous sends are unresolved.

Prerequisites: `sequences.status`

Verify with: `sequences.status`

Retry guidance: Run reconcile and inspect status before retrying a failed tick.

## Reconcile sequence runtime (`sequences.reconcile`)

Use when: Expired leases or an operator-reviewed ambiguous send need recovery.

Avoid when: The delivery outcome of an ambiguous send is still unknown.

Prerequisites: `sequences.status`

Verify with: `sequences.status`

Retry guidance: Inspect sequences.status before retrying; ambiguous-send resolution is not idempotent.

## Inspect sequence runtime health (`sequences.status`)

Use when: Sequence worker readiness or stalled work must be inspected.

Avoid when: A sequence definition rather than runtime health is needed.

Prerequisites: none

Verify with: none

Retry guidance: Retrying the same status read is safe.

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
