# @listmonk-ops/operations

Shared, runtime-neutral operation contracts and executors used by the
listmonk-ops CLI and MCP adapters.

The initial registry covers subscriber-list CRUD. Each operation owns its
runtime input/output schemas, generated JSON Schemas, safety hints, MCP name,
and named executor. Each list operation also exports a named `invoke*Operation`
entrypoint, while `invokeListOperationByMcpName` provides the shared MCP
dispatcher. These functions preserve the registry validation and error contract
while keeping CLI/MCP-to-domain call paths visible to static tooling. Surface
packages remain responsible for authentication and presentation.
