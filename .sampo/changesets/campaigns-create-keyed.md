---
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/cli: minor
---

Promote `campaigns.create` from experimental to stable with the store-backed idempotency key introduced for `lists.create`, now shared through a generic keyed-create executor in `@listmonk-ops/operations`. `campaigns.create` accepts an optional `idempotency_key` (CLI `--idempotency-key`) that is atomically claimed in the durable resource-create store before the create is issued and then bound to the created campaign id: an identical retry replays that campaign as `created: false` without a second POST, a concurrent same-key create waits for the in-flight one instead of issuing a second POST, and a different payload or target under the same key is rejected explicitly. An attempt that ends ambiguously — or whose accepted response carries neither an id nor an immutable uuid to correlate — marks its claim unknown, and later same-key creates fail fast with reconciliation guidance. Unkeyed creates keep the honestly unsafe classification because Listmonk campaign names are not unique. The output contract gains the `created` envelope (`{campaign, created}`), and the CLI/MCP inject the store at their boundaries. The stable TypeScript contract count rises from 84 to 85.
