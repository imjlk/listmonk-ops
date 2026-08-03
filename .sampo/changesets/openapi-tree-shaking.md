---
npm/@listmonk-ops/openapi: minor (Removed)
---

Remove the `rawSdk` namespace export and replace dynamic CRUD method dispatch
with direct named imports of the generated SDK functions.

The previous `rawSdk = sdk` re-export and `import * as sdk` namespace usage in
`crud.ts`, `resource-operations.ts`, and `service-operations.ts` forced
bundlers to retain every generated SDK function, so consumer bundles always
carried all 51 Listmonk endpoints even when the enhanced client never exposed
them. Each CRUD slot now references a specific generated function through a
named import, and slots with no backing endpoint (for example media
create/update) fail lazily with a clear error instead of pinning the namespace.

Measured impact on the published `dist/index.js` bundle: 30,453 → 27,369
bytes (~10% smaller), with nine previously-retained endpoint URLs (public
subscription, maintenance/GC, i18n, analytics cleanup) now stripped at build
time.

`rawSdk` was an internal namespace re-export with no in-repo or graph-traced
consumers; the contract test already asserted its absence on the runtime
client. To call generated functions directly, use the
`@listmonk-ops/openapi/sdk` subpath, which remains fully tree-shakeable.
