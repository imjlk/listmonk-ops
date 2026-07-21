# @listmonk-ops/operations

Shared, runtime-neutral operation contracts and executors used by the
listmonk-ops CLI and MCP adapters.

The registry covers subscriber-list CRUD and transactional email delivery. Each
operation owns its runtime input/output schemas, generated JSON Schemas, safety
hints, MCP name, and named executor. List and transactional operations export
named `invoke*Operation` entrypoints plus domain-specific MCP dispatchers. These
functions preserve the registry validation and error contract while keeping
CLI/MCP-to-domain call paths visible to static tooling. Surface packages remain
responsible for authentication and presentation.
