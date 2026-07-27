# @listmonk-ops/openapi

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

