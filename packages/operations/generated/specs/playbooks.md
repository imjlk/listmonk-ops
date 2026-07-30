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

1. `inspect-remote` → `templates.get` (none approval). Inspect current Listmonk template content.
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
