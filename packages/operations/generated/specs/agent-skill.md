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
