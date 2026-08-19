---
npm/@listmonk-ops/operations: minor
---

Make webhooks.prune retries deterministic and promote the operation from experimental to stable. The prune input now accepts an optional explicit `before` cutoff (also exposed as the CLI `--before` flag), so an automatic retry reuses the exact confirmed deletion window instead of recomputing the cutoff from the current clock. The stable TypeScript contract count rises from 70 to 71.
