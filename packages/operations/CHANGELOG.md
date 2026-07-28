# @listmonk-ops/operations

## 0.6.0 — 2026-07-28

### Added

- [5578960](https://github.com/imjlk/listmonk-ops/commit/557896096810d21701f49834a46a6c9b6dbbd6b7) Add a compiler-driven Email Operations Specification with Typia-generated normalized contracts, effect-derived safety policies, agent guidance, catalog projection, and graph-enforced pilot bindings for campaign get/schedule and subscriber blocklist. — Thanks @imjlk!

## 0.5.0 — 2026-07-27

### Added

- [a5ed6de](https://github.com/imjlk/listmonk-ops/commit/a5ed6de7344256139d32a363f82e8a1c196e85b8) Add optional `idempotency_key` to the transactional send operation.
  
  When a key is supplied, the wrapper atomically claims an idempotency record
  before dispatch. Identical retries replay the original result instead of
  re-sending; a different payload under the same key is rejected as a conflict.
  Ambiguous transport failures (timeout, connection reset) leave an `unknown`
  record that blocks automatic retry **for the TTL window** (24 hours by
  default). After the TTL expires the record is swept and the same key can be
  claimed again, so operators must reconcile within that window or supply a
  fresh key.
  
  The send output is extended to `{ sent, status, duplicate?, idempotency_key?, expires_at? }`
  where `status` is `"accepted" | "replayed" | "failed"`. The store path defaults
  to `~/.listmonk-ops/transactional.json` and is overridable via
  `LISTMONK_OPS_TRANSACTIONAL_STORE`.
  
  `@listmonk-ops/common` now exports the file-backed idempotency store
  (`createFileBackedTransactionalIdempotencyStore`), the SHA-256 payload
  hasher (`hashTransactionalPayload`), and the target-namespace helper
  (`computeTransactionalTargetHash`) that the CLI and MCP adapters inject. — Thanks @imjlk!

### Patch changes

- Updated dependencies: openapi@0.4.1

## 0.4.0 — 2026-07-27

### Added

- [05c99bc](https://github.com/imjlk/listmonk-ops/commit/05c99bca9bf9213124e60b14ab83b288962bf9a8) Add campaign lifecycle, subscriber bulk, transactional hardening, and media upload operations.
  
  Campaign lifecycle (6 new operations): schedule, start, pause, cancel, clone, stats. A new `campaign-lifecycle.ts` state machine rejects obviously invalid transitions before they reach Listmonk's status endpoint. `clone` copies body/lists/template under a new name and resets runtime fields.
  
  Subscriber bulk (4 new operations): add-to-lists, remove-from-lists, blocklist, unblocklist. The new `subscriber-bulk.ts` executor chunks subscriber IDs (default 500, fail-fast by default, optional continue-on-error) and supports dry-run and max-items cap.
  
  Transactional hardening: tighten recipient validation to exactly one of subscriber_email or subscriber_id (XOR), reject header values that smuggle CR/LF/NUL or other control characters, and block reserved transport headers.
  
  Media upload (1 new operation): upload media from base64-encoded contents with a MIME allowlist and a 10 MiB size cap. CLI `media upload --file <path>` reads via Bun.file and encodes the bytes.
  
  OpenAPI contract cleanup: extract CampaignOperations, SubscriberOperations, and MediaOperations into named interfaces mirroring TemplateOperations so the public types no longer rely on anonymous intersections. — Thanks @imjlk!

### Patch changes

- Updated dependencies: openapi@0.4.0

## 0.3.0 — 2026-07-23

### Changed

- [1150985](https://github.com/imjlk/listmonk-ops/commit/115098571442844ea837e4a851869a0ca0f7eee3) Route default-template selection through shared CLI and MCP operations with a stable Listmonk acknowledgement — Thanks @imjlk!
- [6de0c57](https://github.com/imjlk/listmonk-ops/commit/6de0c578fb2ede2451f98fa0bbb4d22f3c992167) Expose shared media read and delete operations through CLI and MCP with consistent confirmation safety. — Thanks @imjlk!

### Added

- [b52b7f1](https://github.com/imjlk/listmonk-ops/commit/b52b7f1fa9e3a34c4c3c99e70eca7a2b094d38c1) Add execution policy metadata and atomic operation audit storage — Thanks @imjlk!
- [9c1e818](https://github.com/imjlk/listmonk-ops/commit/9c1e81837c354d1718da51f5ef46c515cdbc8f79) Add shared operation catalog discovery for CLI and MCP parity — Thanks @imjlk!
- [2b16ee3](https://github.com/imjlk/listmonk-ops/commit/2b16ee3f9b6406509c500048364b18354616de55) Expose effective dry-run resolution after operation input defaults — Thanks @imjlk!

### Patch changes

- Updated dependencies: openapi@0.3.0

## 0.2.0 — 2026-07-21

### Added

- [1281fc3](https://github.com/imjlk/listmonk-ops/commit/1281fc3bc6e23347eb6785f078f9a8df17197429) Preserve transactional legacy text in shared MCP metadata — Thanks @imjlk!
- [6aadc54](https://github.com/imjlk/listmonk-ops/commit/6aadc54de32b6685ed714477c699122334aeaa2e) Add shared campaign, subscriber, and template CRUD operations — Thanks @imjlk!

## 0.1.3 — 2026-07-21

### Changed

- [eb42347](https://github.com/imjlk/listmonk-ops/commit/eb423476d728d5f0fa33900551e634e0629df0c5) Share transactional delivery across CLI and MCP with graph and Mailpit verification — Thanks @imjlk!

## 0.1.2 — 2026-07-21

### Changed

- [db04303](https://github.com/imjlk/listmonk-ops/commit/db0430331540176626593618e05826042749ce1c) Expose graph-visible named list operation invokers, route the CLI and MCP list
  adapters through them, and preserve the existing validated operation contract. — Thanks @imjlk!

## 0.1.1 — 2026-07-20

### Changed

- [13220ca](https://github.com/imjlk/listmonk-ops/commit/13220ca1d9fc82e410ec190d04cc077c31acf8b5) Add a shared typed subscriber-list operation registry, expose validated MCP
  schemas, safety hints, and structured output, and route graph-friendly CLI list
  actions through the same executors with pagination support.
  
  Publish the operations package changes made after its bootstrap 0.1.0 release. — Thanks @imjlk!

### Patch changes

- Updated dependencies: openapi@0.2.0

