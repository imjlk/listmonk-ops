# @listmonk-ops/mcp

## 0.13.0 — 2026-08-22

### Minor changes

- [0c1af5f](https://github.com/imjlk/listmonk-ops/commit/0c1af5f3719e9c037cf12e938d46ead10eedfa67) Make the A/B test create intent durable before remote provisioning. The executor commits the replay key, a canonical request fingerprint (normalized defaults, deterministic placeholders, versioned derivation), and the full create payload in its own store write before provisioning any campaigns or lists, so an ambiguous retry resumes the same test instead of provisioning duplicates, a completed create replays with `created: false`, and an explicit key reused with a different request conflicts explicitly. Launch and stop are blocked while an intent is still provisioning, and legacy records without an intent payload replay as completed creations. `abtest.create` stays experimental until remote resource ids are checkpointed or reconciled on resume. — Thanks @imjlk!
- [4f03e2d](https://github.com/imjlk/listmonk-ops/commit/4f03e2d84b29a89e3f27638b496bb04b50e5a5dc) Promote `subscribers.create` from experimental to stable with documented email-conflict replay, verified against the local Listmonk 6.2 stack (duplicate email returns 409 while duplicate list and template names both create new records). A retry after an ambiguous create now replays the persisted subscriber as `created: false` when it matches every observable create effect (email, name, status, sorted list memberships, canonical attributes — resolved with server-side email filtering); a conflicting configuration under the same email stays an explicit error. The MCP tool output gains the `created` envelope, and the CLI distinguishes an existing subscriber from a fresh create. Also hardens the segment drift store read to reject whitespace-only persisted sample keys. The stable TypeScript contract count rises from 79 to 80. — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.7.0, automation@0.8.0, openapi@0.7.1, operations@0.15.0

## 0.12.0 — 2026-08-13

### Added

- [7f8d7bd](https://github.com/imjlk/listmonk-ops/commit/7f8d7bd1190e34639c5a26b1a6a18cb55b47428f) Complete transactional messenger, subject, content-type, and multipart plain-text option parity across the Workers runtime, shared operations, CLI, MCP, and sequence automation. — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.6.1, automation@0.7.0, openapi@0.7.0, operations@0.14.0

## 0.11.1 — 2026-08-08

### Patch changes

- Updated dependencies: abtest@0.6.0, automation@0.6.0, operations@0.13.0

## 0.11.0 — 2026-08-06

### Added

- [a3a91be](https://github.com/imjlk/listmonk-ops/commit/a3a91bebe01fc2ce05d3a29cbe3a4d050577ebfd) Expose versioned least-privilege user-role manifest reconciliation through the shared CLI and MCP operation boundary with a standalone TypeScript/Typia contract, bounded dry-run planning, explicit confirmation, body-free partial-apply projection, and CLI/MCP parity coverage. — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.5.4, automation@0.5.0, operations@0.12.0

## 0.10.0 — 2026-08-05

### Added

- [8a85420](https://github.com/imjlk/listmonk-ops/commit/8a854206e7b49bb952845561d6b2f678bb3d6d88) Expose versioned template manifest reconciliation through the shared CLI and MCP operation boundary with bounded dry-run planning, explicit confirmation, and parity coverage. — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.5.3, automation@0.4.2, openapi@0.6.0, operations@0.11.0

## 0.9.1 — 2026-08-02

### Patch changes

- Updated dependencies: abtest@0.5.2, automation@0.4.1, openapi@0.5.0, operations@0.10.0

## 0.9.0 — 2026-07-31

### Security

- [1cde446](https://github.com/imjlk/listmonk-ops/commit/1cde4461884bc15cd0bd78089ee3b17fa085363c) Redact sensitive sequence definition and enrollment fields from MCP structured output — Thanks @imjlk!
- [179279f](https://github.com/imjlk/listmonk-ops/commit/179279fa18268aaddbbd7ba15a816efbd1b7e0b4) Redact sensitive webhook endpoint and delivery fields from MCP structured output — Thanks @imjlk!
- [3eb67ba](https://github.com/imjlk/listmonk-ops/commit/3eb67ba5d486bff97b08e52e3a1dfdccf0bf49ea) Return bounded mutation failure codes without raw provider or store errors — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.5.1, automation@0.4.0, operations@0.9.0

## 0.8.0 — 2026-07-30

### Changed

- [ca7e076](https://github.com/imjlk/listmonk-ops/commit/ca7e07630293cba676ca4962ed005583012ddee0) Expose complete shared operation specification coverage through MCP discovery — Thanks @imjlk!

### Added

- [42dd39f](https://github.com/imjlk/listmonk-ops/commit/42dd39f43d0bb1f32b4440820453c79c5b986dfe) Add durable webhook worker health, provider event ingestion, circuit breakers, and dead-letter replay. — Thanks @imjlk!
- [903606f](https://github.com/imjlk/listmonk-ops/commit/903606f44d6cb50a1b16622128c7e55d59e10c8e) Add a compiler-driven durable sequence engine with shared CLI/MCP operations, JSON/Postgres persistence, worker health, and recovery-safe delivery. — Thanks @imjlk!
- [5fe66a8](https://github.com/imjlk/listmonk-ops/commit/5fe66a88835a7ce29658bc566585a686362fd077) Add typed signed outbound event webhooks, durable outbox delivery, and shared CLI/MCP management operations. — Thanks @imjlk!
- [336cde1](https://github.com/imjlk/listmonk-ops/commit/336cde13dad3cfb647467a75f5e1775702fd7f55) Add typed agent discovery and readiness operations across the shared runtime, CLI, and MCP. — Thanks @imjlk!
- [df2de54](https://github.com/imjlk/listmonk-ops/commit/df2de544f7404f8f5a8e4aa59a81b2acb833e8bd) Add compiler-driven SES-first provider and deliverability diagnostics with shared CLI/MCP operations, exact duplicate-safe SMTP pool and credential-fingerprint binding, strict redacted profile configuration, DMARC tree-walk and sender-aware ordered CIDR/DKIM/SPF DNS checks with recursive bounded per-family lookup budgets, partial include authorization, bounded resolved `a`/`mx` range matching, quota inspection, and local-stack parity coverage. — Thanks @imjlk!
- [e91f5f9](https://github.com/imjlk/listmonk-ops/commit/e91f5f9e45fd2464370e50997be95aa528400513) Add a Postgres-backed durable webhook runtime, lease recovery maintenance operations, and typed domain lifecycle event projection. — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.5.0, automation@0.3.0, common@0.5.1, openapi@0.4.2, operations@0.8.0

## 0.7.1 — 2026-07-28

### Patch changes

- Updated dependencies: abtest@0.4.3, automation@0.2.3, operations@0.7.0

## 0.7.0 — 2026-07-28

### Added

- [5578960](https://github.com/imjlk/listmonk-ops/commit/557896096810d21701f49834a46a6c9b6dbbd6b7) Add a compiler-driven Email Operations Specification with Typia-generated normalized contracts, effect-derived safety policies, agent guidance, catalog projection, and graph-enforced pilot bindings for campaign get/schedule and subscriber blocklist. — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.4.2, automation@0.2.2, operations@0.6.0

## 0.6.0 — 2026-07-27

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

## 0.5.0 — 2026-07-27

### Removed

- [d6a27b3](https://github.com/imjlk/listmonk-ops/commit/d6a27b3f701db64d48116c2a01fccd37d46fe11c) Remove deprecated legacy `listmonk_update_campaign_status` MCP tool. Callers should migrate to the shared lifecycle operations: `listmonk_schedule_campaign`, `listmonk_start_campaign`, `listmonk_pause_campaign`, and `listmonk_cancel_campaign`, which provide proper safety metadata, confirmation gates, audit trails, and state-machine validation. — Thanks @imjlk!

### Added

- [05c99bc](https://github.com/imjlk/listmonk-ops/commit/05c99bca9bf9213124e60b14ab83b288962bf9a8) Add campaign lifecycle, subscriber bulk, transactional hardening, and media upload operations.
  
  Campaign lifecycle (6 new operations): schedule, start, pause, cancel, clone, stats. A new `campaign-lifecycle.ts` state machine rejects obviously invalid transitions before they reach Listmonk's status endpoint. `clone` copies body/lists/template under a new name and resets runtime fields.
  
  Subscriber bulk (4 new operations): add-to-lists, remove-from-lists, blocklist, unblocklist. The new `subscriber-bulk.ts` executor chunks subscriber IDs (default 500, fail-fast by default, optional continue-on-error) and supports dry-run and max-items cap.
  
  Transactional hardening: tighten recipient validation to exactly one of subscriber_email or subscriber_id (XOR), reject header values that smuggle CR/LF/NUL or other control characters, and block reserved transport headers.
  
  Media upload (1 new operation): upload media from base64-encoded contents with a MIME allowlist and a 10 MiB size cap. CLI `media upload --file <path>` reads via Bun.file and encodes the bytes.
  
  OpenAPI contract cleanup: extract CampaignOperations, SubscriberOperations, and MediaOperations into named interfaces mirroring TemplateOperations so the public types no longer rely on anonymous intersections. — Thanks @imjlk!

### Patch changes

- [c79e330](https://github.com/imjlk/listmonk-ops/commit/c79e330c1013b32913f864b0f12e31ff3a76e21a) Automation security hardening: SSRF defense in preflight link checking (private IP/loopback/metadata blocking, manual redirect revalidation, bounded concurrency), store path redaction from MCP/CLI operation outputs and error messages, template promote optimistic concurrency (expectedRemoteHash + force), and fractional aggregate baselines in segment drift. — Thanks @imjlk!
- Updated dependencies: abtest@0.4.0, automation@0.2.0, common@0.4.0, openapi@0.4.0, operations@0.4.0

## 0.4.0 — 2026-07-23

### Changed

- [1150985](https://github.com/imjlk/listmonk-ops/commit/115098571442844ea837e4a851869a0ca0f7eee3) Route default-template selection through shared CLI and MCP operations with a stable Listmonk acknowledgement — Thanks @imjlk!
- [6de0c57](https://github.com/imjlk/listmonk-ops/commit/6de0c578fb2ede2451f98fa0bbb4d22f3c992167) Expose shared media read and delete operations through CLI and MCP with consistent confirmation safety. — Thanks @imjlk!
- [f529994](https://github.com/imjlk/listmonk-ops/commit/f5299940f0ebfe38100d112edc970340d06753d4) Harden Streamable HTTP with Host and Origin validation, optional Bearer authentication, and safe non-loopback binding requirements. — Thanks @imjlk!
- [eb86a20](https://github.com/imjlk/listmonk-ops/commit/eb86a20e586f5431d6682c0c893039dba46a0b69) Require explicit confirmation and metadata-only auditing for destructive shared MCP operations — Thanks @imjlk!

### Added

- [71af85e](https://github.com/imjlk/listmonk-ops/commit/71af85ed805d93159c97d30c6035c36b48b3563c) Add local CLI and MCP transactional delivery parity coverage with Mailpit. — Thanks @imjlk!
- [9c1e818](https://github.com/imjlk/listmonk-ops/commit/9c1e81837c354d1718da51f5ef46c515cdbc8f79) Add shared operation catalog discovery for CLI and MCP parity — Thanks @imjlk!

### Fixed

- [85f71e0](https://github.com/imjlk/listmonk-ops/commit/85f71e083d556b6399f2eae178b148fa3e4f0d51) Keep MCP catalog schema assertions isolated so protocol validation remains deterministic across test orderings. — Thanks @imjlk!
- [e2a4483](https://github.com/imjlk/listmonk-ops/commit/e2a4483a64f3f4e95f7a6242351dd521be3a421f) Expose execution policy metadata in MCP operation catalog schema — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.3.1, automation@0.1.7, common@0.3.0, openapi@0.3.0, operations@0.3.0

## 0.3.0 — 2026-07-21

### Changed

- [9128105](https://github.com/imjlk/listmonk-ops/commit/91281057d73e9ac0fa9195ad2f7432e753194d6c) Route CLI and MCP ops workflows through shared typed operation contracts — Thanks @imjlk!

### Added

- [cf17240](https://github.com/imjlk/listmonk-ops/commit/cf17240e4509c548a82cdf7ee816cdc5954d5352) Expose shared A/B test lifecycle operations across CLI and MCP — Thanks @imjlk!
- [1281fc3](https://github.com/imjlk/listmonk-ops/commit/1281fc3bc6e23347eb6785f078f9a8df17197429) Centralize exact MCP tool registration and operation result metadata — Thanks @imjlk!
- [53aa4dc](https://github.com/imjlk/listmonk-ops/commit/53aa4dcd210bbffde7d54b0309e5e14577375f6c) Expose shared campaign, subscriber, and template CRUD parity — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.3.0, automation@0.1.6, operations@0.2.0

## 0.2.2 — 2026-07-21

### Changed

- [eb42347](https://github.com/imjlk/listmonk-ops/commit/eb423476d728d5f0fa33900551e634e0629df0c5) Share transactional delivery across CLI and MCP with graph and Mailpit verification — Thanks @imjlk!

### Patch changes

- Updated dependencies: automation@0.1.5, operations@0.1.3

## 0.2.1 — 2026-07-21

### Changed

- [db04303](https://github.com/imjlk/listmonk-ops/commit/db0430331540176626593618e05826042749ce1c) Expose graph-visible named list operation invokers, route the CLI and MCP list
  adapters through them, and preserve the existing validated operation contract. — Thanks @imjlk!

### Patch changes

- Updated dependencies: operations@0.1.2

## 0.2.0 — 2026-07-20

### Fixed

- [9a20afe](https://github.com/imjlk/listmonk-ops/commit/9a20afee64787f844871d1a5c227f3217a4cdca1) Adopt the TypeScript 7 and ttsc compiler pipeline across development and builds, and keep MCP startup detection compatible with the stricter compiler types. — Thanks @imjlk!
- [1d13791](https://github.com/imjlk/listmonk-ops/commit/1d1379148c9e6b9fe68411f40383cac1b2002962) Target Listmonk v6.2.0 with a reproducible upstream OpenAPI overlay, expose the renamed and newly documented API operations, and provision E2E credentials through Listmonk's hashed API-token flow. — Thanks @imjlk!
- [8ccc103](https://github.com/imjlk/listmonk-ops/commit/8ccc10341381036a05c1eb62241a1000fb563c7b) Stabilize OpenAPI response handling and MCP tools, add regression coverage for Listmonk workflows, and document the updated automation behavior. — Thanks @imjlk!
- [d227f35](https://github.com/imjlk/listmonk-ops/commit/d227f35985afb8c95472991e579f28569c86afdc) Add schema-aware atomic JSON persistence with recoverable cross-process locks,
  migrate automation stores, and share transactional A/B state across CLI and
  MCP workflows. — Thanks @imjlk!

### Added

- [b34d868](https://github.com/imjlk/listmonk-ops/commit/b34d8688e4a9e687ae520bb4a60607fdc844ee32) Expose the existing Listmonk tool registry through standard MCP stdio and Streamable HTTP transports while preserving the legacy REST endpoints. — Thanks @imjlk!
- [13220ca](https://github.com/imjlk/listmonk-ops/commit/13220ca1d9fc82e410ec190d04cc077c31acf8b5) Add a shared typed subscriber-list operation registry, expose validated MCP
  schemas, safety hints, and structured output, and route graph-friendly CLI list
  actions through the same executors with pagination support.
  
  Publish the operations package changes made after its bootstrap 0.1.0 release. — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.2.0, automation@0.1.4, openapi@0.2.0, operations@0.1.1

## 0.1.3 — 2026-03-14

### Changed

- [b225654](https://github.com/imjlk/listmonk-ops/commit/b225654b985bc3f5601af131dfccb53e53f2f093) Refresh workspace dependencies, add Renovate-based dependency automation, and generate Sampo changesets automatically for dependency PRs that touch releasable packages. — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.1.3, automation@0.1.3

## 0.1.2 — 2026-03-14

### Changed

- [3b22b2c](https://github.com/imjlk/listmonk-ops/commit/3b22b2c455c5883e182702eb0bb7355e52528c91) Mark executable packages as Bun-targeted where applicable, harden automation workflows against empty upstream responses, add atomic rollback to A/B test provisioning, and improve package metadata for library consumers. — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.1.2, automation@0.1.2

## 0.1.1 — 2026-03-14

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

- Updated dependencies: abtest@0.1.1, automation@0.1.1

