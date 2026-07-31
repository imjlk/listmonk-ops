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

All 102 public shared operations attach an
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

Sixty-one contracts are authored as TypeScript types and projected with Typia.
The remaining 41 operations use a committed
`runtime-operation` bridge snapshot of the normalized executor boundary while
their standalone product types are developed. Runtime bridges are always
`experimental`; they never import `@listmonk-ops/openapi` or generated SDK
types. Twenty-three reviewed core operations are `stable`, including the first
read-only promotion batch for list, subscriber, campaign, template, and media
inspection plus the static `specs.*`, `playbooks.*`, and agent control-plane
discovery operations. The live, open-world `control.status` health probe
remains experimental.
Their complete contracts, effects, policies, retry semantics, states, and MCP
names are protected by an explicitly accepted compatibility baseline.

The same subpath exports four guarded typed playbooks
(`campaign.safe-start`, `campaign.safe-schedule`, `template.safe-promote`, and
`abtest.safe-run`), 15 resource state models, and 31 runtime-backed lifecycle event
declarations. Every public shared `defineOperation()` call binds a descriptor;
the public migration exemption manifest is empty. Repository coverage,
governance, compatibility, and compiler-graph gates enforce those invariants.

The specs live in `src/specs` and are published as a subpath of this package,
not as a separate workspace. After changing a normalized contract or
descriptor, run `bun run generate:specs`; generated references are checked in
under `generated/specs`, including operation, resource, event, playbook,
agent-skill, graph, stable compatibility, and migration-exemption artifacts.
Run `bun run specs:stable:accept` only after explicitly reviewing an intentional
stable-contract change.

When a normalized shared-operation Zod boundary changes, build the workspaces,
run `bun run operations:specs:runtime-contracts:generate` from the repository
root, review the snapshot diff, and regenerate the spec artifacts. The final
root build loads all 102 runtime operations and rejects any bridge drift.

The main package exports a `discoveryOperationCatalog` with shared named
invokers for `specs.search`, `specs.describe`, `playbooks.list`,
`playbooks.get`, `control.capabilities`, `control.prime`, and
`control.status`. CLI and MCP adapters supply their composed catalog and
runtime health probe; search, safety policy, playbook expansion, and readiness
semantics remain transport-neutral.
