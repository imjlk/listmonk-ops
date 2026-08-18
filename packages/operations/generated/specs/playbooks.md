# Email Operations Playbooks

> Generated from `@listmonk-ops/operations/specs`. Do not edit manually.

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
