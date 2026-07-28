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
