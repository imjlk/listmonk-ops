---
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/cli: minor
---

Promote `campaigns.clone` from experimental to stable with the store-backed idempotency key, shared through the same keyed-create executor as the other keyed creates. `campaigns.clone` accepts an optional `idempotency_key` (CLI `--idempotency-key`) that is atomically claimed in the durable resource-create store before the clone create is issued and then bound to the cloned campaign id: an identical retry (same key, same source campaign and clone name, same Listmonk target) replays that campaign with `created: false` without a second POST, a concurrent same-key clone waits for the in-flight one, and a different request or target under the same key is rejected explicitly. Keyed clones bind through the created record's id or its immutable uuid — the unkeyed path's name-snapshot fallback is deliberately not used, because it cannot prove ownership; an uncorrelatable accepted response marks the claim unknown and later same-key clones fail fast with reconciliation guidance. Unkeyed clones keep the honestly unsafe classification. The output contract gains the `created` envelope (`{campaign, created}`), and the CLI injects the file-backed store at its boundary (the MCP campaigns handler already does). The stable TypeScript contract count rises from 87 to 88.
