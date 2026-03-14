---
npm/@listmonk-ops/openapi: patch (Changed)
npm/@listmonk-ops/automation: patch (Changed)
---

Stabilize external package consumption and release workflow setup.

- `@listmonk-ops/openapi`
  - improved runtime fetch resilience with safer retry policy
  - fixed config merge behavior for explicit `retries: 0`
  - aligned package entrypoints and exports for external Node/Bun usage
- `@listmonk-ops/automation`
  - package rename from legacy ops scope and workspace path normalization
  - publishable package metadata and docs cleanup for external reuse
