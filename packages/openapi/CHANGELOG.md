# @listmonk-ops/openapi

## 0.7.1 — 2026-08-25

### Fixed

- [ae54654](https://github.com/imjlk/listmonk-ops/commit/ae54654dab146b2bbbf8e7ef09061573a66757b0) Use manual redirect handling for Cloudflare Workers transactional delivery — Thanks @imjlk!

## 0.7.0 — 2026-08-13

### Added

- [3d74ff2](https://github.com/imjlk/listmonk-ops/commit/3d74ff205417f9a2ab8b2b4d1041d564e53fe864) Allow Workers runtime transactional sends to select a validated From address and Listmonk messenger. — Thanks @imjlk!
- [7f8d7bd](https://github.com/imjlk/listmonk-ops/commit/7f8d7bd1190e34639c5a26b1a6a18cb55b47428f) Complete transactional messenger, subject, content-type, and multipart plain-text option parity across the Workers runtime, shared operations, CLI, MCP, and sequence automation. — Thanks @imjlk!

### Fixed

- [1e4644c](https://github.com/imjlk/listmonk-ops/commit/1e4644c3a57b3e08924bc2bc86b7e3a7fd5aa32f) Validate transactional From overrides as one mailbox across shared sends and sequence definitions, and align the published sender, messenger, and subject contracts with runtime parsing. — Thanks @imjlk!

## 0.6.0 — 2026-08-05

### Added

- [35b1354](https://github.com/imjlk/listmonk-ops/commit/35b13543893b7da1c3b97391d54f84e1d7e4029f) Add the tree-shakable `@listmonk-ops/openapi/runtime` entrypoint for Fetch-compatible
  services such as Cloudflare Workers. It normalizes Listmonk API origins, creates
  HTTPS-only token-authenticated clients, and sends single-recipient external
  transactional messages without creating subscribers. Runtime failures expose
  bounded error codes, diagnostic reasons, and HTTP status without copying remote
  bodies or recipient data. Requests use a configurable 30-second default timeout
  and expose aborts and timeouts as ambiguous, non-retry-safe outcomes. — Thanks @imjlk!

### Removed

- [1e16bbb](https://github.com/imjlk/listmonk-ops/commit/1e16bbb6fd8094f00d9558323921d7c3f13b8e65) Remove the `rawSdk` namespace export and replace dynamic CRUD method dispatch
  with direct named imports of the generated SDK functions.
  
  The previous `rawSdk = sdk` re-export and `import * as sdk` namespace usage in
  `crud.ts`, `resource-operations.ts`, and `service-operations.ts` forced
  bundlers to retain every generated SDK function, so consumer bundles always
  carried all 51 Listmonk endpoints even when the enhanced client never exposed
  them. Each CRUD slot now references a specific generated function through a
  named import, and slots with no backing endpoint (for example media
  create/update) fail lazily with a clear error instead of pinning the namespace.
  
  Measured impact on the published `dist/index.js` bundle: 30,453 → 27,127
  bytes (~11% smaller), with nine previously-retained endpoint URLs (public
  subscription, maintenance/GC, i18n, analytics cleanup) now stripped at build
  time.
  
  `rawSdk` was a documented module-level export with no in-repo or graph-traced
  consumers. Its removal is a breaking public API change. To call generated
  functions directly, use the `@listmonk-ops/openapi/sdk` subpath, which remains
  fully tree-shakeable. — Thanks @imjlk!

## 0.5.0 — 2026-08-02

### Added

- [a595f71](https://github.com/imjlk/listmonk-ops/commit/a595f716ba92a95de384e0aa07f6af54ffd90469) Add a typed Listmonk 6.2 user-role facade, declarative least-privilege role
  reconciliation, generic permission presets, and external-subscriber SDK smoke
  coverage. — Thanks @imjlk!

## 0.4.2 — 2026-07-30

### Changed

- [ca7e076](https://github.com/imjlk/listmonk-ops/commit/ca7e07630293cba676ca4962ed005583012ddee0) Update the shared esbuild toolchain to the patched 0.28.1 release — Thanks @imjlk!

## 0.4.1 — 2026-07-27

### Changed

- [a711306](https://github.com/imjlk/listmonk-ops/commit/a711306c3c6dc47b74bb0e262b6689c4bc4794c1) Update the OpenAPI spec README to remove a dangling reference to the deleted MISSING_API_ENDPOINTS.md document. — Thanks @imjlk!

## 0.4.0 — 2026-07-27

### Fixed

- [769ed92](https://github.com/imjlk/listmonk-ops/commit/769ed92f319ff70243d0ba22e6cb68c077ca3c44) Add deterministic SHA-256 assignment and chunked bulk membership to A/B test provisioning so retries and reconciliation never re-split the audience, and correct the subscriber manageLists `target_list_ids` type to an array (the Listmonk v6.2.0 server rejects scalars). Migrate the on-disk store to schema version 2 with backward-compatible v1 reads. Update automation hygiene to wrap targetListId in an array for the corrected manageLists signature. — Thanks @imjlk!

### Changed

- [05c99bc](https://github.com/imjlk/listmonk-ops/commit/05c99bca9bf9213124e60b14ab83b288962bf9a8) Add campaign lifecycle, subscriber bulk, transactional hardening, and media upload operations.
  
  Campaign lifecycle (6 new operations): schedule, start, pause, cancel, clone, stats. A new `campaign-lifecycle.ts` state machine rejects obviously invalid transitions before they reach Listmonk's status endpoint. `clone` copies body/lists/template under a new name and resets runtime fields.
  
  Subscriber bulk (4 new operations): add-to-lists, remove-from-lists, blocklist, unblocklist. The new `subscriber-bulk.ts` executor chunks subscriber IDs (default 500, fail-fast by default, optional continue-on-error) and supports dry-run and max-items cap.
  
  Transactional hardening: tighten recipient validation to exactly one of subscriber_email or subscriber_id (XOR), reject header values that smuggle CR/LF/NUL or other control characters, and block reserved transport headers.
  
  Media upload (1 new operation): upload media from base64-encoded contents with a MIME allowlist and a 10 MiB size cap. CLI `media upload --file <path>` reads via Bun.file and encodes the bytes.
  
  OpenAPI contract cleanup: extract CampaignOperations, SubscriberOperations, and MediaOperations into named interfaces mirroring TemplateOperations so the public types no longer rely on anonymous intersections. — Thanks @imjlk!

## 0.3.0 — 2026-07-23

### Changed

- [1150985](https://github.com/imjlk/listmonk-ops/commit/115098571442844ea837e4a851869a0ca0f7eee3) Route default-template selection through shared CLI and MCP operations with a stable Listmonk acknowledgement — Thanks @imjlk!

## 0.2.0 — 2026-07-20

### Changed

- [1d13791](https://github.com/imjlk/listmonk-ops/commit/1d1379148c9e6b9fe68411f40383cac1b2002962) Target Listmonk v6.2.0 with a reproducible upstream OpenAPI overlay, expose the renamed and newly documented API operations, and provision E2E credentials through Listmonk's hashed API-token flow. — Thanks @imjlk!

### Fixed

- [8ccc103](https://github.com/imjlk/listmonk-ops/commit/8ccc10341381036a05c1eb62241a1000fb563c7b) Stabilize OpenAPI response handling and MCP tools, add regression coverage for Listmonk workflows, and document the updated automation behavior. — Thanks @imjlk!
- [1518101](https://github.com/imjlk/listmonk-ops/commit/151810192825dbe9209c33dd90ed05f1606eacc6) Split the handwritten client into named namespace factories, preserve aborts
  during retry backoff, normalize bounce and media list operations, and add an
  opt-in generated SDK graph contract with direct factory tests. — Thanks @imjlk!

## 0.1.5 — 2026-03-14

### Changed

- [b225654](https://github.com/imjlk/listmonk-ops/commit/b225654b985bc3f5601af131dfccb53e53f2f093) Refresh workspace dependencies, add Renovate-based dependency automation, and generate Sampo changesets automatically for dependency PRs that touch releasable packages. — Thanks @imjlk!

## 0.1.4 — 2026-03-14

### Added

- [3b22b2c](https://github.com/imjlk/listmonk-ops/commit/3b22b2c455c5883e182702eb0bb7355e52528c91) Add a tree-shakable `@listmonk-ops/openapi/sdk` entrypoint, update the generated SDK to `@hey-api/openapi-ts@0.94.1`, and cover the raw client `buildUrl()` behavior with a regression test. — Thanks @imjlk!

## 0.1.3 — 2026-03-14

### Changed

- [55b04d5](https://github.com/imjlk/listmonk-ops/commit/55b04d5489bd19c85891e698903d80c6f64b6fd3) Stabilize external package consumption and release workflow setup.
  
  - `@listmonk-ops/openapi`
    - improved runtime fetch resilience with safer retry policy
    - fixed config merge behavior for explicit `retries: 0`
    - aligned package entrypoints and exports for external Node/Bun usage
  - `@listmonk-ops/automation`
    - package rename from legacy ops scope and workspace path normalization
    - publishable package metadata and docs cleanup for external reuse — Thanks @imjlk!

