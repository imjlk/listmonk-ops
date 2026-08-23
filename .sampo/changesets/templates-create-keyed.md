---
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/cli: minor
---

Promote `templates.create` from experimental to stable with the store-backed idempotency key, shared through the same keyed-create executor as `lists.create` and `campaigns.create`. `templates.create` accepts an optional `idempotency_key` (CLI `--idempotency-key`) that is atomically claimed in the durable resource-create store before the create is issued and then bound to the created template id: an identical retry replays that template as `created: false` without a second POST, a concurrent same-key create waits for the in-flight one instead of issuing a second POST, and a different payload or target under the same key is rejected explicitly. Template records carry no uuid, so binding requires the id in the create response — an id-less accepted response marks the claim unknown and later same-key creates fail fast with reconciliation guidance. Unkeyed creates keep the honestly unsafe classification because Listmonk template names are not unique. The output contract gains the `created` envelope (`{template, created}`), and the CLI/MCP inject the store at their boundaries. The stable TypeScript contract count rises from 85 to 86.
