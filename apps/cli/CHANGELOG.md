# @listmonk-ops/cli

## 0.8.0 — 2026-07-28

### Added

- [5578960](https://github.com/imjlk/listmonk-ops/commit/557896096810d21701f49834a46a6c9b6dbbd6b7) Add a compiler-driven Email Operations Specification with Typia-generated normalized contracts, effect-derived safety policies, agent guidance, catalog projection, and graph-enforced pilot bindings for campaign get/schedule and subscriber blocklist. — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.4.2, automation@0.2.2, operations@0.6.0

## 0.7.0 — 2026-07-27

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

- Updated dependencies: abtest@0.4.1, automation@0.2.1, common@0.5.0, openapi@0.4.1, operations@0.5.0

## 0.6.0 — 2026-07-27

### Added

- [db9a23c](https://github.com/imjlk/listmonk-ops/commit/db9a23cb9015fce0f00d7995f55c19568d6fa7f9) Add orchestration lifecycle (scheduled launches, tick-based progression, reconcile), new lifecycle statuses, and shared send_at scheduling so all variant campaigns fire simultaneously. CLI gains `abtest run`, `abtest tick --dry-run`, and `abtest reconcile` commands. — Thanks @imjlk!
- [05c99bc](https://github.com/imjlk/listmonk-ops/commit/05c99bca9bf9213124e60b14ab83b288962bf9a8) Add campaign lifecycle, subscriber bulk, transactional hardening, and media upload operations.
  
  Campaign lifecycle (6 new operations): schedule, start, pause, cancel, clone, stats. A new `campaign-lifecycle.ts` state machine rejects obviously invalid transitions before they reach Listmonk's status endpoint. `clone` copies body/lists/template under a new name and resets runtime fields.
  
  Subscriber bulk (4 new operations): add-to-lists, remove-from-lists, blocklist, unblocklist. The new `subscriber-bulk.ts` executor chunks subscriber IDs (default 500, fail-fast by default, optional continue-on-error) and supports dry-run and max-items cap.
  
  Transactional hardening: tighten recipient validation to exactly one of subscriber_email or subscriber_id (XOR), reject header values that smuggle CR/LF/NUL or other control characters, and block reserved transport headers.
  
  Media upload (1 new operation): upload media from base64-encoded contents with a MIME allowlist and a 10 MiB size cap. CLI `media upload --file <path>` reads via Bun.file and encodes the bytes.
  
  OpenAPI contract cleanup: extract CampaignOperations, SubscriberOperations, and MediaOperations into named interfaces mirroring TemplateOperations so the public types no longer rely on anonymous intersections. — Thanks @imjlk!

### Minor changes

- [763ad72](https://github.com/imjlk/listmonk-ops/commit/763ad726e96e01fe91a0a95fe81935ea1d10e2b1) Add global --format human|json|ndjson|quiet flag for stream-aware CLI output. JSON and NDJSON modes send data to stdout and human messages to stderr. Quiet mode suppresses all non-error human output. All command handlers now route through getOutput() instead of OutputUtils directly. — Thanks @imjlk!

### Patch changes

- [9181c28](https://github.com/imjlk/listmonk-ops/commit/9181c28cef62c23f2147bbf3ae28790321948ff9) Fix automation correctness: hygiene mode-specific validation and PII redaction (breaking: sample field email → emailMasked), digest lifetime/window metric separation with truncation reporting, guard minimum-sent gate, and segment drift baseline mode selection. — Thanks @imjlk!
- [c79e330](https://github.com/imjlk/listmonk-ops/commit/c79e330c1013b32913f864b0f12e31ff3a76e21a) Automation security hardening: SSRF defense in preflight link checking (private IP/loopback/metadata blocking, manual redirect revalidation, bounded concurrency), store path redaction from MCP/CLI operation outputs and error messages, template promote optimistic concurrency (expectedRemoteHash + force), and fractional aggregate baselines in segment drift. — Thanks @imjlk!
- Updated dependencies: abtest@0.4.0, automation@0.2.0, common@0.4.0, openapi@0.4.0, operations@0.4.0

## 0.5.0 — 2026-07-23

### Changed

- [1150985](https://github.com/imjlk/listmonk-ops/commit/115098571442844ea837e4a851869a0ca0f7eee3) Route default-template selection through shared CLI and MCP operations with a stable Listmonk acknowledgement — Thanks @imjlk!
- [1150985](https://github.com/imjlk/listmonk-ops/commit/115098571442844ea837e4a851869a0ca0f7eee3) Require confirmation and audit shared CLI operations — Thanks @imjlk!
- [06c1bd0](https://github.com/imjlk/listmonk-ops/commit/06c1bd090f0ad8f5b5e651408491077730da8cd2) Add graph-enforced direct regression coverage for A/B test CLI input and every shared operation invoker. — Thanks @imjlk!
- [6de0c57](https://github.com/imjlk/listmonk-ops/commit/6de0c578fb2ede2451f98fa0bbb4d22f3c992167) Expose shared media read and delete operations through CLI and MCP with consistent confirmation safety. — Thanks @imjlk!

### Added

- [9c1e818](https://github.com/imjlk/listmonk-ops/commit/9c1e81837c354d1718da51f5ef46c515cdbc8f79) Add shared operation catalog discovery for CLI and MCP parity — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.3.1, automation@0.1.7, common@0.3.0, openapi@0.3.0, operations@0.3.0

## 0.4.0 — 2026-07-21

### Added

- [1281fc3](https://github.com/imjlk/listmonk-ops/commit/1281fc3bc6e23347eb6785f078f9a8df17197429) Expose subscriber-list CRUD commands through the CLI — Thanks @imjlk!
- [cf17240](https://github.com/imjlk/listmonk-ops/commit/cf17240e4509c548a82cdf7ee816cdc5954d5352) Expose shared A/B test lifecycle operations across CLI and MCP — Thanks @imjlk!
- [53aa4dc](https://github.com/imjlk/listmonk-ops/commit/53aa4dcd210bbffde7d54b0309e5e14577375f6c) Expose shared campaign, subscriber, and template CRUD parity — Thanks @imjlk!

### Changed

- [9128105](https://github.com/imjlk/listmonk-ops/commit/91281057d73e9ac0fa9195ad2f7432e753194d6c) Route CLI and MCP ops workflows through shared typed operation contracts — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.3.0, automation@0.1.6, operations@0.2.0

## 0.3.2 — 2026-07-21

### Changed

- [eb42347](https://github.com/imjlk/listmonk-ops/commit/eb423476d728d5f0fa33900551e634e0629df0c5) Share transactional delivery across CLI and MCP with graph and Mailpit verification — Thanks @imjlk!

### Patch changes

- Updated dependencies: automation@0.1.5, operations@0.1.3

## 0.3.1 — 2026-07-21

### Changed

- [db04303](https://github.com/imjlk/listmonk-ops/commit/db0430331540176626593618e05826042749ce1c) Expose graph-visible named list operation invokers, route the CLI and MCP list
  adapters through them, and preserve the existing validated operation contract. — Thanks @imjlk!

### Patch changes

- Updated dependencies: operations@0.1.2

## 0.3.0 — 2026-07-20

### Changed

- [a56544c](https://github.com/imjlk/listmonk-ops/commit/a56544cf914c7819f5377035d77edc9a4daeb037) Replace Bunli with Gunshi while preserving the existing command tree and legacy boolean/completion input, add native Linux arm64 releases, and validate both source and compiled CLI contracts. — Thanks @imjlk!
- [13220ca](https://github.com/imjlk/listmonk-ops/commit/13220ca1d9fc82e410ec190d04cc077c31acf8b5) Add a shared typed subscriber-list operation registry, expose validated MCP
  schemas, safety hints, and structured output, and route graph-friendly CLI list
  actions through the same executors with pagination support.
  
  Publish the operations package changes made after its bootstrap 0.1.0 release. — Thanks @imjlk!

### Fixed

- [d227f35](https://github.com/imjlk/listmonk-ops/commit/d227f35985afb8c95472991e579f28569c86afdc) Add schema-aware atomic JSON persistence with recoverable cross-process locks,
  migrate automation stores, and share transactional A/B state across CLI and
  MCP workflows. — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.2.0, automation@0.1.4, common@0.2.0, openapi@0.2.0, operations@0.1.1

## 0.2.3 — 2026-03-14

### Changed

- [b225654](https://github.com/imjlk/listmonk-ops/commit/b225654b985bc3f5601af131dfccb53e53f2f093) Refresh workspace dependencies, add Renovate-based dependency automation, and generate Sampo changesets automatically for dependency PRs that touch releasable packages. — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.1.3, automation@0.1.3, common@0.1.3, openapi@0.1.5

## 0.2.2 — 2026-03-14

### Patch changes

- Updated dependencies: abtest@0.1.2, automation@0.1.2, common@0.1.2, openapi@0.1.4

## 0.2.1 — 2026-03-14

### Changed

- [55b04d5](https://github.com/imjlk/listmonk-ops/commit/55b04d5489bd19c85891e698903d80c6f64b6fd3) Expand package publishability and release ergonomics across CLI/MCP-related workspaces.
  
  - `@listmonk-ops/cli`
    - publish-ready package metadata (`bin`, `files`, `prepublishOnly`, semver deps)
    - completion metadata packaging alignment for npm installs
    - GitHub release binary pipeline and curl installer support
  - `@listmonk-ops/common`
    - compiled `dist` entrypoints for external Node/Bun consumers
  - `@listmonk-ops/abtest`
    - publish-ready package metadata and semver dependency references
  - `@listmonk-ops/mcp`
    - publish-ready metadata (`bin`, `files`, semver deps)
    - runtime CLI flags for explicit Listmonk endpoint/auth config — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.1.1, automation@0.1.1, common@0.1.1, openapi@0.1.3

