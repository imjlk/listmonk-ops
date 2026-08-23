---
npm/@listmonk-ops/common: minor
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/cli: minor
---

Promote `lists.create` from experimental to stable with a store-backed idempotency key. A new file-backed resource-create idempotency store in `@listmonk-ops/common` (schema-versioned, atomic writes, configured with `LISTMONK_OPS_RESOURCE_CREATE_STORE` and a `LISTMONK_OPS_RESOURCE_CREATE_STORE_MAX_RECORDS` soft cap, namespaced by the resolved Listmonk target) atomically claims `idempotency_key` (CLI `--idempotency-key`) before the create is issued and then binds it to the created list id: an identical retry replays that list as `created: false` without a second POST, a concurrent same-key create waits for the in-flight one instead of issuing a second POST, and a different payload or target under the same key is rejected explicitly. A live same-host claim is never stolen by age; a crashed attempt's pending claim is recovered by adopting a same-named list only when its attributes and creation time (against the persisted first-claim time) prove it was the attempt's product, with a bounded settle-and-requery before recreating. Keyed creates require the injected store, so surfaces without one reject the key instead of silently dropping the guarantee. Unkeyed creates keep the honestly unsafe classification because Listmonk list names are not unique. The output contract gains the `created` envelope, and the CLI/MCP inject the store at their boundaries. The stable TypeScript contract count rises from 83 to 84.
