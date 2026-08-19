---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/cli: minor
---

Make webhooks.prune destructive runs delete exactly the echoed delivery set and promote the operation from experimental to stable. Dry runs now report the eligible delivery ids alongside the `before` cutoff, and destructive (non-dry-run) calls must echo both — so a confirmed deletion can never drift with the clock and an automatic retry deletes nothing new. The CLI exposes the set as `webhooks prune --ids` (comma-separated, required with `--no-dry-run`). The stable TypeScript contract count rises from 70 to 71.
