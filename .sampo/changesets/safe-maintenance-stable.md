---
npm/@listmonk-ops/operations: minor
---

Promote 3 operations from experimental to stable: control.status (read-only health probe with hardened readiness contract), subscribers.remove-from-lists (safe retry with dry-run), and ops.campaign.deliverability-guard (convergent evaluation). webhooks.prune and ops.templates.registry-promote remain experimental after review identified non-idempotent retry behavior. The stable TypeScript contract count rises from 62 to 65.
