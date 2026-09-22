---
npm/@listmonk-ops/operations: patch
npm/@listmonk-ops/cli: patch
---

Upgrade operation contract generation to Typia 15 and align CI, native CLI builds, release publishing, and worker examples on Bun 1.4.2. Keep the TypeScript 5.9 OpenAPI compatibility pin and current ttsc 0.30.4 toolchain.

Refresh GitHub release tooling and run native CLI contract tests before merge. The updated Sampo action regenerates Bun lockfiles directly instead of relying on the legacy install workaround.
