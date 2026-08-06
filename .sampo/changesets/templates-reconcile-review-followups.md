---
npm/@listmonk-ops/operations: patch
---

Address Codex review follow-ups on the templates.reconcile standalone contract: drop the subject MaxLength<500> bound and document the empty-string default, and exclude transport-only controls (dry_run) from the raw manifest byte cap so the documented 1 MiB limit measures manifest content. The same byte-cap fix is applied to user-roles.reconcile for consistency.
