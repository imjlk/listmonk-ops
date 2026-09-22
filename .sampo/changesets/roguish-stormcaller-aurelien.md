---
npm/@listmonk-ops/operations: patch
npm/@listmonk-ops/cli: patch
npm/@listmonk-ops/common: patch
---

Upgrade operation contract generation to Typia 15 and align CI, native CLI builds, release publishing, and worker examples on Bun 1.4.2. Keep the TypeScript 5.9 OpenAPI compatibility pin and current ttsc 0.30.4 toolchain.

Refresh GitHub release tooling and run native CLI contract tests before merge. The updated Sampo action regenerates Bun lockfiles directly instead of relying on the legacy install workaround.

Write JSON output through the stdout stream so large catalog responses are fully drained before the CLI exits on Linux.
