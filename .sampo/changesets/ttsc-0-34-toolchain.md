---
npm/@listmonk-ops/operations: patch (Changed)
npm/@listmonk-ops/openapi: patch (Changed)
---

Build with ttsc 0.34.3 and typia 15.2.2. ttsc now compiles with each package's own native TypeScript, so `@listmonk-ops/openapi`, which keeps the legacy TypeScript 5.9 runtime for code generation, also declares TypeScript 7.0.2 under the `@typescript/native` alias. This is a build-toolchain update with no source changes, and the generated operation contracts are unchanged.
