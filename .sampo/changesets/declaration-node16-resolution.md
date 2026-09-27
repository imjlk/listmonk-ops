---
npm/@listmonk-ops/openapi: patch (Fixed)
npm/@listmonk-ops/operations: patch (Fixed)
npm/@listmonk-ops/common: patch (Fixed)
npm/@listmonk-ops/automation: patch (Fixed)
npm/@listmonk-ops/abtest: patch (Fixed)
---

Fixed the published TypeScript declarations for `"moduleResolution": "node16"` and `"nodenext"`. The declarations imported their sibling files without extensions (for example `./src/client/index`), which only `bundler` resolution follows, so node16 and nodenext consumers could not resolve the typings of any entry point or subpath export, including `@listmonk-ops/openapi/sdk`, `@listmonk-ops/openapi/runtime`, and `@listmonk-ops/operations/specs`. Every relative import in the published declarations now names its runtime file (`./client.js` or `./client/index.js`), and the runtime JavaScript is unchanged. `@listmonk-ops/openapi` and `@listmonk-ops/common` support TypeScript 5.0 or newer; `@listmonk-ops/operations`, `@listmonk-ops/automation`, and `@listmonk-ops/abtest` expose zod 4 types, whose declarations need TypeScript 5.4 or newer when `skipLibCheck` is off.
