# @listmonk-ops/cli

## 0.14.0 — 2026-08-22

### Minor changes

- [a8a9012](https://github.com/imjlk/listmonk-ops/commit/a8a901201b8cd9a21fa92fc16272dee273c31906) Harden `ops.templates.registry-rollback` with an optional `to_version_id` pin (CLI `--to-version-id`). A pinned rollback whose target is already the active version reports `rolled_back: false` without another mutation, a registry that moved so the pinned target is no longer the previous version fails explicitly instead of silently rolling elsewhere, and a template with no previous version fails instead of falling back to the penultimate entry. The operation stays experimental: ABA transitions and remote drift outside the registry remain indistinguishable without a source-version pin. — Thanks @imjlk!
- [f96b71d](https://github.com/imjlk/listmonk-ops/commit/f96b71d26514608212c5ee108ea71e6637e3103a) Let segment drift snapshots deduplicate by an explicit sampling period. `ops segment-drift` (and the `ops.segments.drift` operation) accepts `--sample-key`: snapshots sharing a list ID and sample key replace their predecessor instead of appending, and same-key snapshots are excluded from the comparison baseline, so an ambiguous retry never double-weights the period. The output reports how many snapshots the run replaced. Unkeyed runs keep the previous append semantics. — Thanks @imjlk!
- [8561554](https://github.com/imjlk/listmonk-ops/commit/85615549255566c3a7c7a54683254a2cc82c887b) Make webhooks.prune destructive runs delete exactly the echoed delivery set and promote the operation from experimental to stable. Dry runs now report the eligible delivery ids alongside the `before` cutoff, and destructive (non-dry-run) calls must echo both — so a confirmed deletion can never drift with the clock and an automatic retry deletes nothing new. The CLI exposes the set as `webhooks prune --ids` (comma-separated, required with `--no-dry-run`). The stable TypeScript contract count rises from 70 to 71. — Thanks @imjlk!
- [722b77f](https://github.com/imjlk/listmonk-ops/commit/722b77fa3e0305ca2335cbec7f38be4b641e9e1a) Give `ops.subscribers.hygiene` echoed candidate sets. The input accepts an optional `subscriber_ids` set (CLI `--subscriber-ids`, strictly parsed; required when `dry_run` is false, enforced both at the operation boundary and in the exported workflow): destructive runs process exactly the echoed set, subscribers that left the eligible set are skipped, echoed sets larger than the effective limit are rejected instead of truncated, and winback additions are per-subscriber idempotent memberships. The operation stays experimental — a subscriber that re-enters eligibility is re-selected by the identical echoed request, the same re-entry hazard that keeps dead-letter replay experimental. — Thanks @imjlk!
- [4f03e2d](https://github.com/imjlk/listmonk-ops/commit/4f03e2d84b29a89e3f27638b496bb04b50e5a5dc) Promote `subscribers.create` from experimental to stable with documented email-conflict replay, verified against the local Listmonk 6.2 stack (duplicate email returns 409 while duplicate list and template names both create new records). A retry after an ambiguous create now replays the persisted subscriber as `created: false` when it matches every observable create effect (email, name, status, sorted list memberships, canonical attributes — resolved with server-side email filtering); a conflicting configuration under the same email stays an explicit error. The MCP tool output gains the `created` envelope, and the CLI distinguishes an existing subscriber from a fresh create. Also hardens the segment drift store read to reject whitespace-only persisted sample keys. The stable TypeScript contract count rises from 79 to 80. — Thanks @imjlk!
- [82d5cec](https://github.com/imjlk/listmonk-ops/commit/82d5cec57910ed07b8c362ea53396c856729f466) Apply the prune echo pattern to `webhooks.dlq.replay`. The input accepts an optional `delivery_ids` set (CLI `--delivery-ids`, required with `--no-dry-run`, modeled as a discriminated contract union): destructive runs requeue exactly the echoed dead-letter set and records that already left the dead-letter set are skipped in both the file and repository paths, so an identical retry replays nothing new. The operation stays experimental — a worker can re-exhaust a replayed record before the retry, making the identical echoed request eligible again. — Thanks @imjlk!
- [b5776c2](https://github.com/imjlk/listmonk-ops/commit/b5776c2970d29cc4e37ffe1a26be959dd9bb7c4f) Promote the purely local-store creates with documented replay semantics. `webhooks.create` and `sequences.create` replay an identically configured existing name as `created: false` (a conflicting configuration under the same name still fails explicitly). `abtest.create` accepts an optional `idempotency_key` (CLI `--idempotency-key`) that is derived from the request when omitted and resolves the replay inside one serialized write, but stays experimental until the key is durable before remote campaign provisioning. The stable TypeScript contract count rises from 77 to 79. — Thanks @imjlk!
- [4ad67d5](https://github.com/imjlk/listmonk-ops/commit/4ad67d590a53eed4ec89c9466448a55b4aa08e88) Harden webhooks.prune deletion windows. The prune input now accepts an optional explicit `before` cutoff — RFC 3339 timestamps with timezone offsets included — and destructive (non-dry-run) calls are required to echo the cutoff a dry run reported, so a confirmed deletion window can never drift with the clock. The CLI exposes the same cutoff as `webhooks prune --before`, which takes precedence over `--older-than-days`. Bounded retries are now documented honestly as continuing with the next oldest batch inside the confirmed window, so the operation stays experimental with reconcile-style retry metadata. — Thanks @imjlk!
- [7c85f96](https://github.com/imjlk/listmonk-ops/commit/7c85f964b9872be831bc84701a2a8db50d3d7b2f) Promote the four remaining delete operations from experimental to stable by making an already-deleted resource a documented no-op: `webhooks.delete`, `sequences.delete`, and `abtest.delete` now report `deleted: false` instead of surfacing not-found errors on repeats, and `templates.delete` distinguishes Listmonk's shared "non-existent or default template" rejection so only a genuinely missing template becomes a no-op while the protected default template still fails explicitly. The webhook and sequence delete outputs make the echoed record optional when nothing was deleted. The stable TypeScript contract count rises from 71 to 75. — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.7.0, automation@0.8.0, openapi@0.7.1, operations@0.15.0

## 0.13.0 — 2026-08-13

### Added

- [7f8d7bd](https://github.com/imjlk/listmonk-ops/commit/7f8d7bd1190e34639c5a26b1a6a18cb55b47428f) Complete transactional messenger, subject, content-type, and multipart plain-text option parity across the Workers runtime, shared operations, CLI, MCP, and sequence automation. — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.6.1, automation@0.7.0, openapi@0.7.0, operations@0.14.0

## 0.12.2 — 2026-08-08

### Changed

- [79fff23](https://github.com/imjlk/listmonk-ops/commit/79fff23608b1349184d799eae0b8a9ce5d7a4f62) Stop publishing macOS Intel binaries, restrict prebuilt macOS releases to Apple silicon, and fail fast when the installer runs on an Intel Mac. — Thanks @imjlk!

## 0.12.1 — 2026-08-08

### Patch changes

- Updated dependencies: abtest@0.6.0, automation@0.6.0, operations@0.13.0

## 0.12.0 — 2026-08-06

### Added

- [a3a91be](https://github.com/imjlk/listmonk-ops/commit/a3a91bebe01fc2ce05d3a29cbe3a4d050577ebfd) Expose versioned least-privilege user-role manifest reconciliation through the shared CLI and MCP operation boundary with a standalone TypeScript/Typia contract, bounded dry-run planning, explicit confirmation, body-free partial-apply projection, and CLI/MCP parity coverage. — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.5.4, automation@0.5.0, operations@0.12.0

## 0.11.0 — 2026-08-05

### Added

- [8a85420](https://github.com/imjlk/listmonk-ops/commit/8a854206e7b49bb952845561d6b2f678bb3d6d88) Expose versioned template manifest reconciliation through the shared CLI and MCP operation boundary with bounded dry-run planning, explicit confirmation, and parity coverage. — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.5.3, automation@0.4.2, openapi@0.6.0, operations@0.11.0

## 0.10.1 — 2026-08-02

### Patch changes

- Updated dependencies: abtest@0.5.2, automation@0.4.1, openapi@0.5.0, operations@0.10.0

## 0.10.0 — 2026-07-31

### Security

- [1cde446](https://github.com/imjlk/listmonk-ops/commit/1cde4461884bc15cd0bd78089ee3b17fa085363c) Redact sensitive sequence definition and enrollment fields from CLI JSON output — Thanks @imjlk!
- [179279f](https://github.com/imjlk/listmonk-ops/commit/179279fa18268aaddbbd7ba15a816efbd1b7e0b4) Redact sensitive webhook endpoint and delivery fields from CLI JSON output — Thanks @imjlk!
- [3eb67ba](https://github.com/imjlk/listmonk-ops/commit/3eb67ba5d486bff97b08e52e3a1dfdccf0bf49ea) Omit raw remote failure text and subscriber identifiers from automation output — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.5.1, automation@0.4.0, operations@0.9.0

## 0.9.0 — 2026-07-30

### Added

- [42dd39f](https://github.com/imjlk/listmonk-ops/commit/42dd39f43d0bb1f32b4440820453c79c5b986dfe) Add durable webhook worker health, provider event ingestion, circuit breakers, and dead-letter replay. — Thanks @imjlk!
- [903606f](https://github.com/imjlk/listmonk-ops/commit/903606f44d6cb50a1b16622128c7e55d59e10c8e) Add a compiler-driven durable sequence engine with shared CLI/MCP operations, JSON/Postgres persistence, worker health, and recovery-safe delivery. — Thanks @imjlk!
- [5fe66a8](https://github.com/imjlk/listmonk-ops/commit/5fe66a88835a7ce29658bc566585a686362fd077) Add typed signed outbound event webhooks, durable outbox delivery, and shared CLI/MCP management operations. — Thanks @imjlk!
- [336cde1](https://github.com/imjlk/listmonk-ops/commit/336cde13dad3cfb647467a75f5e1775702fd7f55) Add typed agent discovery and readiness operations across the shared runtime, CLI, and MCP. — Thanks @imjlk!
- [ca7e076](https://github.com/imjlk/listmonk-ops/commit/ca7e07630293cba676ca4962ed005583012ddee0) Complete the compiler-driven email operations specification for all public shared operations and expose inspected-state guards through CLI lifecycle commands — Thanks @imjlk!
- [df2de54](https://github.com/imjlk/listmonk-ops/commit/df2de544f7404f8f5a8e4aa59a81b2acb833e8bd) Add compiler-driven SES-first provider and deliverability diagnostics with shared CLI/MCP operations, exact duplicate-safe SMTP pool and credential-fingerprint binding, strict redacted profile configuration, DMARC tree-walk and sender-aware ordered CIDR/DKIM/SPF DNS checks with recursive bounded per-family lookup budgets, partial include authorization, bounded resolved `a`/`mx` range matching, quota inspection, and local-stack parity coverage. — Thanks @imjlk!
- [e91f5f9](https://github.com/imjlk/listmonk-ops/commit/e91f5f9e45fd2464370e50997be95aa528400513) Add a Postgres-backed durable webhook runtime, lease recovery maintenance operations, and typed domain lifecycle event projection. — Thanks @imjlk!

### Changed

- [ca7e076](https://github.com/imjlk/listmonk-ops/commit/ca7e07630293cba676ca4962ed005583012ddee0) Update agent discovery contracts for complete operation specification coverage — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.5.0, automation@0.3.0, common@0.5.1, openapi@0.4.2, operations@0.8.0

## 0.8.1 — 2026-07-28

### Patch changes

- Updated dependencies: abtest@0.4.3, automation@0.2.3, operations@0.7.0

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

