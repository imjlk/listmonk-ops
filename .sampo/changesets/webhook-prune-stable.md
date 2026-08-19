---
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/cli: minor
---

Make webhooks.prune retries deterministic and promote the operation from experimental to stable. The prune input now accepts an optional explicit `before` cutoff — RFC 3339 timestamps with timezone offsets included — so an automatic retry reuses the exact confirmed deletion window instead of recomputing the cutoff from the current clock. The CLI exposes the same cutoff as `webhooks prune --before`, which takes precedence over `--older-than-days`. The stable TypeScript contract count rises from 70 to 71.
