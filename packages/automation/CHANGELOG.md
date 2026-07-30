# @listmonk-ops/automation

## 0.3.0 — 2026-07-30

### Added

- [42dd39f](https://github.com/imjlk/listmonk-ops/commit/42dd39f43d0bb1f32b4440820453c79c5b986dfe) Add durable webhook worker health, provider event ingestion, circuit breakers, and dead-letter replay. — Thanks @imjlk!
- [903606f](https://github.com/imjlk/listmonk-ops/commit/903606f44d6cb50a1b16622128c7e55d59e10c8e) Add a compiler-driven durable sequence engine with shared CLI/MCP operations, JSON/Postgres persistence, worker health, and recovery-safe delivery. — Thanks @imjlk!
- [5fe66a8](https://github.com/imjlk/listmonk-ops/commit/5fe66a88835a7ce29658bc566585a686362fd077) Add typed signed outbound event webhooks, durable outbox delivery, and shared CLI/MCP management operations. — Thanks @imjlk!
- [ca7e076](https://github.com/imjlk/listmonk-ops/commit/ca7e07630293cba676ca4962ed005583012ddee0) Complete the compiler-driven email operations specification for all public shared operations and expose inspected-state guards through CLI lifecycle commands — Thanks @imjlk!
- [df2de54](https://github.com/imjlk/listmonk-ops/commit/df2de544f7404f8f5a8e4aa59a81b2acb833e8bd) Add compiler-driven SES-first provider and deliverability diagnostics with shared CLI/MCP operations, exact duplicate-safe SMTP pool and credential-fingerprint binding, strict redacted profile configuration, DMARC tree-walk and sender-aware ordered CIDR/DKIM/SPF DNS checks with recursive bounded per-family lookup budgets, partial include authorization, bounded resolved `a`/`mx` range matching, quota inspection, and local-stack parity coverage. — Thanks @imjlk!
- [e91f5f9](https://github.com/imjlk/listmonk-ops/commit/e91f5f9e45fd2464370e50997be95aa528400513) Add a Postgres-backed durable webhook runtime, lease recovery maintenance operations, and typed domain lifecycle event projection. — Thanks @imjlk!

### Changed

- [ca7e076](https://github.com/imjlk/listmonk-ops/commit/ca7e07630293cba676ca4962ed005583012ddee0) Update the shared esbuild toolchain to the patched 0.28.1 release — Thanks @imjlk!

### Fixed

- [903606f](https://github.com/imjlk/listmonk-ops/commit/903606f44d6cb50a1b16622128c7e55d59e10c8e) Keep webhook workers healthy after transient heartbeat failures, avoid circuit trips for disabled backlog, and prune abandoned workers. — Thanks @imjlk!

### Patch changes

- Updated dependencies: common@0.5.1, openapi@0.4.2, operations@0.8.0

## 0.2.3 — 2026-07-28

### Changed

- [2117c34](https://github.com/imjlk/listmonk-ops/commit/2117c342c0415c1f75d9a323dc9c5f665f4f962b) Register automation and A/B test operations with explicit operation-spec migration coverage. — Thanks @imjlk!

### Patch changes

- Updated dependencies: operations@0.7.0

## 0.2.2 — 2026-07-28

### Patch changes

- Updated dependencies: operations@0.6.0

## 0.2.1 — 2026-07-27

### Patch changes

- Updated dependencies: common@0.5.0, openapi@0.4.1, operations@0.5.0

## 0.2.0 — 2026-07-27

### Fixed

- [769ed92](https://github.com/imjlk/listmonk-ops/commit/769ed92f319ff70243d0ba22e6cb68c077ca3c44) Add deterministic SHA-256 assignment and chunked bulk membership to A/B test provisioning so retries and reconciliation never re-split the audience, and correct the subscriber manageLists `target_list_ids` type to an array (the Listmonk v6.2.0 server rejects scalars). Migrate the on-disk store to schema version 2 with backward-compatible v1 reads. Update automation hygiene to wrap targetListId in an array for the corrected manageLists signature. — Thanks @imjlk!

### Minor changes

- [9181c28](https://github.com/imjlk/listmonk-ops/commit/9181c28cef62c23f2147bbf3ae28790321948ff9) Fix automation correctness: hygiene mode-specific validation and PII redaction (breaking: sample field email → emailMasked), digest lifetime/window metric separation with truncation reporting, guard minimum-sent gate, and segment drift baseline mode selection. — Thanks @imjlk!
- [c79e330](https://github.com/imjlk/listmonk-ops/commit/c79e330c1013b32913f864b0f12e31ff3a76e21a) Automation security hardening: SSRF defense in preflight link checking (private IP/loopback/metadata blocking, manual redirect revalidation, bounded concurrency), store path redaction from MCP/CLI operation outputs and error messages, template promote optimistic concurrency (expectedRemoteHash + force), and fractional aggregate baselines in segment drift. — Thanks @imjlk!

### Patch changes

- Updated dependencies: common@0.4.0, openapi@0.4.0, operations@0.4.0

## 0.1.7 — 2026-07-23

### Added

- [9c1e818](https://github.com/imjlk/listmonk-ops/commit/9c1e81837c354d1718da51f5ef46c515cdbc8f79) Add shared operation catalog discovery for CLI and MCP parity — Thanks @imjlk!

### Patch changes

- Updated dependencies: common@0.3.0, openapi@0.3.0, operations@0.3.0

## 0.1.6 — 2026-07-21

### Added

- [2d5f2f1](https://github.com/imjlk/listmonk-ops/commit/2d5f2f1849ee042d237ef7b31913bd48d957e080) Expose typed ops operation contracts for CLI and MCP parity — Thanks @imjlk!

### Patch changes

- Updated dependencies: operations@0.2.0

## 0.1.5 — 2026-07-21

### Fixed

- [085ed77](https://github.com/imjlk/listmonk-ops/commit/085ed77e146e8327fbe8b8d341de87ba4e05a60d) Stabilize concurrent segment snapshot test ordering on loaded CI runners — Thanks @imjlk!

## 0.1.4 — 2026-07-20

### Changed

- [8ccc103](https://github.com/imjlk/listmonk-ops/commit/8ccc10341381036a05c1eb62241a1000fb563c7b) Stabilize OpenAPI response handling and MCP tools, add regression coverage for Listmonk workflows, and document the updated automation behavior. — Thanks @imjlk!
- [d227f35](https://github.com/imjlk/listmonk-ops/commit/d227f35985afb8c95472991e579f28569c86afdc) Add schema-aware atomic JSON persistence with recoverable cross-process locks,
  migrate automation stores, and share transactional A/B state across CLI and
  MCP workflows. — Thanks @imjlk!

### Patch changes

- Updated dependencies: common@0.2.0, openapi@0.2.0

## 0.1.3 — 2026-03-14

### Changed

- [b225654](https://github.com/imjlk/listmonk-ops/commit/b225654b985bc3f5601af131dfccb53e53f2f093) Refresh workspace dependencies, add Renovate-based dependency automation, and generate Sampo changesets automatically for dependency PRs that touch releasable packages. — Thanks @imjlk!

### Patch changes

- Updated dependencies: openapi@0.1.5

## 0.1.2 — 2026-03-14

### Changed

- [3b22b2c](https://github.com/imjlk/listmonk-ops/commit/3b22b2c455c5883e182702eb0bb7355e52528c91) Mark executable packages as Bun-targeted where applicable, harden automation workflows against empty upstream responses, add atomic rollback to A/B test provisioning, and improve package metadata for library consumers. — Thanks @imjlk!

### Patch changes

- Updated dependencies: openapi@0.1.4

## 0.1.1 — 2026-03-14

### Changed

- [55b04d5](https://github.com/imjlk/listmonk-ops/commit/55b04d5489bd19c85891e698903d80c6f64b6fd3) Stabilize external package consumption and release workflow setup.
  
  - `@listmonk-ops/openapi`
    - improved runtime fetch resilience with safer retry policy
    - fixed config merge behavior for explicit `retries: 0`
    - aligned package entrypoints and exports for external Node/Bun usage
  - `@listmonk-ops/automation`
    - package rename from legacy ops scope and workspace path normalization
    - publishable package metadata and docs cleanup for external reuse — Thanks @imjlk!

### Patch changes

- Updated dependencies: openapi@0.1.3

