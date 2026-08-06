---
npm/@listmonk-ops/operations: patch
---

Migrate the `templates.reconcile` operation spec from a runtime-operation bridge to a standalone TypeScript/Typia product contract, reducing the runtime bridge count from 42 to 41. The manifest reconciliation contract (1 MiB/500 template bounds, dry-run default, body-free partial-apply projection, explicit confirmation) is preserved, and the apply-error projection no longer retains the raw remote cause.
