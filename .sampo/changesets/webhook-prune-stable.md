---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/cli: minor
---

Harden webhooks.prune deletion windows. The prune input now accepts an optional explicit `before` cutoff — RFC 3339 timestamps with timezone offsets included — and destructive (non-dry-run) calls are required to echo the cutoff a dry run reported, so a confirmed deletion window can never drift with the clock. The CLI exposes the same cutoff as `webhooks prune --before`, which takes precedence over `--older-than-days`. Bounded retries are now documented honestly as continuing with the next oldest batch inside the confirmed window, so the operation stays experimental with reconcile-style retry metadata.
