---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/abtest: minor
npm/@listmonk-ops/cli: minor
---

Promote the local-store creates from experimental to stable with documented replay semantics. `webhooks.create` and `sequences.create` replay an identically configured existing name as `created: false` (a conflicting configuration under the same name still fails explicitly), and `abtest.create` accepts an optional `idempotency_key` (CLI `--idempotency-key`) that is derived from the request when omitted, so identical retries return the originally created test instead of provisioning duplicate campaigns. The stable TypeScript contract count rises from 77 to 80.
