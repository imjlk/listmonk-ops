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

Seven operations attach an `@listmonk-ops/operations/specs` descriptor: the
campaign get/schedule/start/cancel lifecycle, subscriber blocklisting,
transactional send, and campaign preflight operations. The operation
definition validates that runtime identity, safety hints, and MCP metadata
still match the declaration, while catalog summaries expose a detached
descriptor for agent discovery. This does not replace Zod runtime validation
or the named executor path.

The same subpath exports the guarded `campaign.safe-start` typed playbook and
the staged migration manifest. Every shared `defineOperation()` call must bind
exactly one descriptor or dated migration exemption. Each family catalog
checks its exemption set, and the repository's post-build coverage gate checks
all shared families together.

The specs live in `src/specs` and are published as a subpath of this package,
not as a separate workspace. After changing a normalized contract or
descriptor, run `bun run generate:specs`; generated references are checked in
under `generated/specs`, including operation, playbook, agent-skill, graph, and
migration-exemption artifacts.
