# Email Operations Resources

> Generated from `@listmonk-ops/operations/specs`. Do not edit manually.

## `campaign` — Campaign

States: `draft`, `scheduled`, `running`, `paused`, `finished`, `cancelled`.

Terminal states: `finished`, `cancelled`.

Transitions:

- `draft` → `scheduled`, `running`
- `scheduled` → `running`
- `running` → `paused`, `cancelled`
- `paused` → `running`
- `finished` → none
- `cancelled` → none

## `subscriber` — Subscriber

States: `enabled`, `disabled`, `blocklisted`.

Terminal states: none.

Transitions:

- `enabled` → `disabled`, `blocklisted`
- `disabled` → `enabled`, `blocklisted`
- `blocklisted` → `enabled`

## `message` — Transactional message

States: `ready`, `accepted`, `failed`, `unknown`.

Terminal states: `accepted`, `failed`.

Transitions:

- `ready` → `accepted`, `failed`, `unknown`
- `accepted` → none
- `failed` → none
- `unknown` → `accepted`, `failed`

## `spec` — Operation specification

States: `available`.

Terminal states: none.

Transitions:

- `available` → none

## `playbook` — Operation playbook

States: `available`.

Terminal states: none.

Transitions:

- `available` → none

## `control` — Operations control plane

States: `ready`.

Terminal states: none.

Transitions:

- `ready` → none

## `operation` — Operation execution

States: `started`, `blocked`, `succeeded`, `failed`.

Terminal states: `blocked`, `succeeded`, `failed`.

Transitions:

- `started` → `blocked`, `succeeded`, `failed`
- `blocked` → none
- `succeeded` → none
- `failed` → none

## `webhook` — Outbound webhook

States: `enabled`, `disabled`.

Terminal states: none.

Transitions:

- `enabled` → `disabled`
- `disabled` → `enabled`

## `experiment` — Email experiment

States: `draft`, `testing`, `scheduled`, `running`, `analyzing`, `deploying`, `cancelling`, `completed`, `inconclusive`, `failed`, `cancelled`.

Terminal states: `completed`, `inconclusive`, `failed`, `cancelled`.

Transitions:

- `draft` → `testing`, `scheduled`, `cancelled`, `failed`
- `testing` → `draft`, `scheduled`, `cancelling`, `failed`
- `scheduled` → `running`, `cancelling`, `cancelled`, `failed`
- `running` → `analyzing`, `cancelling`, `cancelled`, `failed`
- `analyzing` → `deploying`, `completed`, `inconclusive`, `cancelling`, `failed`
- `deploying` → `analyzing`, `completed`, `cancelling`, `failed`
- `cancelling` → `cancelled`, `failed`
- `completed` → none
- `inconclusive` → none
- `failed` → none
- `cancelled` → none

## `sequence` — Headless email sequence

States: `active`, `paused`, `deleted`.

Terminal states: `deleted`.

Transitions:

- `active` → `paused`, `deleted`
- `paused` → `active`, `deleted`
- `deleted` → none

## `provider` — Email delivery provider

States: `configured`, `healthy`, `degraded`, `unavailable`.

Terminal states: none.

Transitions:

- `configured` → `healthy`, `degraded`, `unavailable`
- `healthy` → `degraded`, `unavailable`
- `degraded` → `healthy`, `unavailable`
- `unavailable` → `healthy`, `degraded`

## `list` — Subscriber list

States: `active`, `deleted`.

Terminal states: `deleted`.

Transitions:

- `active` → `deleted`
- `deleted` → none

## `template` — Email template

States: `active`, `default`, `deleted`.

Terminal states: `deleted`.

Transitions:

- `active` → `default`, `deleted`
- `default` → `active`, `deleted`
- `deleted` → none

## `media` — Media asset

States: `available`, `deleted`.

Terminal states: `deleted`.

Transitions:

- `available` → `deleted`
- `deleted` → none

## `audience` — Resolved audience

States: `current`, `drifted`, `suppressed`.

Terminal states: none.

Transitions:

- `current` → `drifted`, `suppressed`
- `drifted` → `current`, `suppressed`
- `suppressed` → `current`

## `user-role` — User role

States: `active`, `protected`, `deleted`.

Terminal states: `protected`, `deleted`.

Transitions:

- `active` → `deleted`
- `protected` → none
- `deleted` → none
