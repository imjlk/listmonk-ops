# @listmonk-ops/operations

Shared, runtime-neutral operation contracts and executors used by the
listmonk-ops CLI and MCP adapters.

The registry covers subscriber-list, campaign, subscriber, and template CRUD;
media read/delete; transactional email delivery; and the domain families owned
by the automation and A/B-test packages. Each operation owns its runtime
input/output schemas, generated JSON Schemas, safety hints, MCP name, and named
executor. Resource and transactional operations export named
`invoke*Operation` entrypoints plus domain-specific MCP dispatchers. These
functions preserve the registry validation and error contract while keeping
CLI/MCP-to-domain call paths visible to static tooling. Surface packages remain
responsible for authentication and presentation.

The shared transactional operation accepts an exact messenger, subject
override, and multipart plain-text alternative in addition to template data,
content type, sender, and validated custom headers. These fields participate in
the idempotency payload hash, so reusing a key with different delivery or
rendering options is rejected instead of replaying the wrong send.
Sender overrides are normalized and validated as one bare or display-name
mailbox before Listmonk can acknowledge the queued delivery.
Custom headers are limited to application metadata: message identity,
authentication results and signatures, routing and delivery trace metadata,
and `ARC-*` / `Resent-*` fields remain transport-owned and are rejected before
dispatch.

Release provisioning can plan one exact-name template with
`reconcileTemplate`, or a versioned set with `reconcileTemplateManifest`.
Planning is read-only by default; `{ apply: true }` or `ensureTemplate` applies
the change. Duplicate manifest or remote names fail closed, and a complete
manifest is planned before its first mutation. Apply the manifest before using
the automation package's version registry for promotion or rollback.
Remote writes are not transactional; `TemplateManifestApplyError` reports the
failed template and the entries completed before the failure.
An omitted `body_source` remains unmanaged to match Listmonk's preserve-on-
update behavior; specify it to enforce visual-template source.
`templates.reconcile` publishes the same behavior to CLI and MCP with a
500-entry and 1 MiB serialized-payload bound, default dry run, explicit
confirmation, and body-free success and partial-failure summaries.

User-role provisioning follows the same explicit-apply model through
`reconcileUserRole`, `reconcileUserRoleManifest`, and `ensureUserRole`. Desired
permissions are validated against the exported Listmonk 6.2 permission
vocabulary and normalized as a set. Duplicate exact names fail closed, the
entire manifest is planned before its first write, partial apply results remain
observable, and the reserved Super Admin role (ID 1) is never managed. Generic
presets separate transactional subscriber delivery from template provisioning;
the control-plane credential performing reconciliation must separately hold
`roles:get` and `roles:manage`. `user-roles.reconcile` publishes the same
behavior to CLI and MCP with a 500-role and 1 MiB serialized-payload bound,
default dry run, explicit confirmation, and body-free success and
partial-failure summaries.

All 119 public shared operations attach an
`@listmonk-ops/operations/specs` descriptor. The operation definition validates
runtime identity, safety hints, MCP metadata, and normalized input/output
contracts against the declaration, while catalog summaries expose a detached
descriptor for agent discovery. This does not replace Zod runtime validation
or the named executor path.

The specs are product-domain declarations, not a copy of Listmonk's generated
endpoint types. The dependency direction is:

```text
Listmonk OpenAPI transport
  -> handwritten client adapter
  -> normalized shared operation executor
  -> operation spec (resource, effect, policy, retry, agent context)
```

All 116 contracts are authored as TypeScript types and projected with Typia,
and all 119 are `stable`; the bounce family, the campaign preview, test-send,
and analytics operations, the dashboard aggregate reads, the subscriber
import lifecycle, the template preview read, and the subscriber
data-portability export joined the accepted baseline after local-stack
verification.
The runtime-operation bridge infrastructure is now empty — all operations
have standalone product-domain contracts. Ninety reviewed core operations
are `stable`, including the first
read-only promotion batch for list, subscriber, campaign, template, and media
inspection plus the static `specs.*`, `playbooks.*`, and agent control-plane
discovery operations and the seven normalized provider/deliverability
inspection operations. Stable open-world diagnostics protect their output
shape, redaction boundary, and retry semantics without promising live provider
availability or a particular diagnostic outcome. Pure sequence validation and
aggregate-only sequence/webhook runtime health are also stable closed-world
reads. Redacted endpoint, delivery, and dead-letter reads are stable as well:
endpoint output exposes only origin, fingerprint, and secret-reference
presence, while delivery output exposes subject and stored-error presence
without their values. Redacted sequence-definition and enrollment reads are
stable as well: revisions expose counts, types, and content fingerprints, while
enrollments expose subscriber-reference and stored-error presence without
their values. Sequence pause/resume, webhook circuit reset, standalone
template manifest reconciliation, idempotent plan-then-apply user-role
manifest reconciliation, exact-set webhook delivery pruning, every
resource delete (repeats report `deleted: false` as a documented no-op),
and the local-store creates (name-intent replays for webhooks and
sequences, email-intent replays for subscribers), keyed drift
snapshots (conditional retry), already-applied sequence updates,
tag-reconciled A/B test creation, keyed list, campaign, template, and media creates
plus keyed campaign clones are stable mutations. The runtime-readiness
`control.status` operation is stable since its readiness contract was hardened.
Experimental mutation contracts are audited with the same redaction boundary:
they may expose bounded error codes, counts, and presence flags, but not raw
provider/store error messages, secret references, or subscriber identifiers.
Their complete contracts, effects, policies, retry semantics, states, and MCP
names are protected by an explicitly accepted compatibility baseline.

The same subpath exports seven guarded typed playbooks
(`campaign.safe-start`, `campaign.safe-schedule`, `template.safe-promote`,
`abtest.safe-run`, `campaign.deliverability-guard`,
`provider.health-check`, and `webhook.retention`), 16 resource state models, and 31 runtime-backed lifecycle
event declarations. Every public shared `defineOperation()` call binds a descriptor;
the public migration exemption manifest is empty. Repository coverage,
governance, compatibility, and compiler-graph gates enforce those invariants.

The specs live in `src/specs` and are published as a subpath of this package,
not as a separate workspace. After changing a normalized contract or
descriptor, run `bun run generate:specs`; generated references are checked in
under `generated/specs`, including operation, resource, event, playbook,
agent-skill, graph, stable compatibility, and migration-exemption artifacts.
Run `bun run specs:stable:accept` only after explicitly reviewing an intentional
stable-contract change.

The runtime-operation bridge infrastructure is now empty — all 119
operations have standalone product-domain contracts. The final root
build loads all 119 runtime operations and validates them against their
standalone TypeScript contracts.

The main package exports a `discoveryOperationCatalog` with shared named
invokers for `specs.search`, `specs.describe`, `playbooks.list`,
`playbooks.get`, `control.capabilities`, `control.prime`, and
`control.status`. CLI and MCP adapters supply their composed catalog and
runtime health probe; search, safety policy, playbook expansion, and readiness
semantics remain transport-neutral.
