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
