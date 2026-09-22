---
npm/@listmonk-ops/cli: patch
npm/@listmonk-ops/common: patch
npm/@listmonk-ops/mcp: patch
---

Keep CLI machine output parseable: omit banners, serialize empty resource lists, and report bounded errors on stderr without runtime source dumps. Verify source and native binary output contracts.

Buffer auxiliary domain diagnostics at the CLI boundary so rollback and cleanup failures cannot interleave raw error stacks with the machine-readable stderr document.
