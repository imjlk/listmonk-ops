---
npm/@listmonk-ops/common: minor (Added)
npm/@listmonk-ops/operations: minor (Added)
npm/@listmonk-ops/cli: minor (Added)
npm/@listmonk-ops/mcp: minor (Added)
---

Add optional `idempotency_key` to the transactional send operation.

When a key is supplied, the wrapper atomically claims an idempotency record
before dispatch. Identical retries replay the original result instead of
re-sending; a different payload under the same key is rejected as a conflict.
Ambiguous transport failures (timeout, connection reset) leave an `unknown`
record that blocks automatic retry until an operator reconciles.

The send output is extended to `{ sent, status, duplicate?, idempotency_key?, expires_at? }`
where `status` is `"accepted" | "replayed" | "failed"`. The store path defaults
to `~/.listmonk-ops/transactional.json` and is overridable via
`LISTMONK_OPS_TRANSACTIONAL_STORE`.

`@listmonk-ops/common` now exports the file-backed idempotency store
(`createFileBackedTransactionalIdempotencyStore`), the SHA-256 payload
hasher (`hashTransactionalPayload`), and the target-namespace helper
(`computeTransactionalTargetHash`) that the CLI and MCP adapters inject.
