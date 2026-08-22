---
npm/@listmonk-ops/common: minor
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/cli: minor
---

Promote `lists.create` from experimental to stable with a durable idempotency key. A new file-backed resource-create idempotency store in `@listmonk-ops/common` (schema-versioned, atomic writes, namespaced by the resolved Listmonk target) binds `idempotency_key` (CLI `--idempotency-key`) to the created list id: an identical retry replays that list as `created: false` without a second POST, and a different payload or target under the same key is rejected explicitly. Unkeyed creates keep the honestly unsafe classification because Listmonk list names are not unique. The output contract gains the `created` envelope, and the CLI/MCP inject the store at their boundaries. The stable TypeScript contract count rises from 83 to 84.
