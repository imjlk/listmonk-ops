---
npm/@listmonk-ops/openapi: patch (Fixed)
npm/@listmonk-ops/cli: patch (Fixed)
npm/@listmonk-ops/operations: patch (Fixed)
---

Fixed npm packaging. `@listmonk-ops/openapi` no longer declares a `typescript` peer dependency, so it installs into projects pinned to any TypeScript version (the declarations need TypeScript 5.0 or newer with `moduleResolution: "bundler"`), and installing it or the CLI no longer pulls in a TypeScript 7 compiler. The npm `listmonk-cli` bundle now loads the shared `@listmonk-ops/*` packages from its dependencies instead of embedding private copies, so errors thrown by `@listmonk-ops/automation` keep their class identity (for example, `webhooks dispatch` prints its structured recovery handle) and the package shrinks from about 1.9 MB to 0.3 MB unpacked. `@listmonk-ops/operations` no longer publishes its repository-only spec gate artifacts, trimming about 2.6 MB.
