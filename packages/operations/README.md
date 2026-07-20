# @listmonk-ops/operations

Shared, runtime-neutral operation contracts and executors used by the
listmonk-ops CLI and MCP adapters.

The initial registry covers subscriber-list CRUD. Each operation owns its
runtime input/output schemas, generated JSON Schemas, safety hints, MCP name,
and named executor. Surface packages remain responsible for authentication and
presentation.
