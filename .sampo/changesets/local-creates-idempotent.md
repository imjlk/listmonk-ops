---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/abtest: minor
npm/@listmonk-ops/cli: minor
---

Promote the purely local-store creates with documented replay semantics. `webhooks.create` and `sequences.create` replay an identically configured existing name as `created: false` (a conflicting configuration under the same name still fails explicitly). `abtest.create` accepts an optional `idempotency_key` (CLI `--idempotency-key`) that is derived from the request when omitted and resolves the replay inside one serialized write, but stays experimental until the key is durable before remote campaign provisioning. The stable TypeScript contract count rises from 77 to 79.
