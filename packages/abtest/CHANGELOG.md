# @listmonk-ops/abtest

## 0.4.0 — 2026-07-24

### Fixed

- [9fa34f7](https://github.com/imjlk/listmonk-ops/commit/9fa34f7c9e4c4d6b441e60a92c0607a87677a3c3) Fix top-two Holm family duplicate when control is a top performer, and expose minimumTestSampleSize in the operation output schema. — Thanks @imjlk!
- [5cc0780](https://github.com/imjlk/listmonk-ops/commit/5cc0780801c728528e5ddb2542112aaed9e8937f) Fix PR-44 review findings: idempotency check before validation, PII field sanitization on store, mixed-currency rejection in aggregate, attribution window NaN guard, and report winnerVariantId population from test. — Thanks @imjlk!
- [352ffa1](https://github.com/imjlk/listmonk-ops/commit/352ffa10f582fa72f97c42a5f69d66d9359437d2) Fix PR-3 followup issues: deleteTest now uses status-aware rollback for scheduled/running campaigns, reconcile --repair requires explicit scope, running tests without endsAt no longer auto-advance to analyzing, and README docs are updated with the new lifecycle commands and MCP tools. — Thanks @imjlk!
- [6c97283](https://github.com/imjlk/listmonk-ops/commit/6c972835651e058de589a89d51f43174eabd4964) Harden A/B test correctness: exact largest-remainder allocation, paginated UUID-deduped audience resolution, fail-closed metrics collection, status-aware cancel/cleanup planning, and confidence-threshold-driven statistics. Document the Listmonk v6.2.0 API behavior (bulk membership requires target_list_ids as an array, scheduled/draft campaigns cannot be cancelled only deleted, campaign tag filter uses the singular param) that informed these fixes. — Thanks @imjlk!

### Added

- [2c30522](https://github.com/imjlk/listmonk-ops/commit/2c30522e92ea4e9d1895c253b40fc25c341d818d) Add Holm-Bonferroni multiple-comparison correction, fixed-horizon eligibility gate, and Sample Ratio Mismatch (SRM) detection for A/B/C test analysis. StatisticalAnalysis output now includes correctedPValue, holmCorrected, srmPassed, and fixedHorizonReasonCodes fields. — Thanks @imjlk!
- [db9a23c](https://github.com/imjlk/listmonk-ops/commit/db9a23cb9015fce0f00d7995f55c19568d6fa7f9) Add orchestration lifecycle (scheduled launches, tick-based progression, reconcile), new lifecycle statuses, and shared send_at scheduling so all variant campaigns fire simultaneously. CLI gains `abtest run`, `abtest tick --dry-run`, and `abtest reconcile` commands. — Thanks @imjlk!
- [f041da1](https://github.com/imjlk/listmonk-ops/commit/f041da1db58263845f938712e87030cba048b22e) Add ConversionEventStore for conversion/revenue attribution, Experiment report generator (Markdown/JSON), and weighted sample-size validation that respects per-variant percentages. — Thanks @imjlk!
- [769ed92](https://github.com/imjlk/listmonk-ops/commit/769ed92f319ff70243d0ba22e6cb68c077ca3c44) Add deterministic SHA-256 assignment and chunked bulk membership to A/B test provisioning so retries and reconciliation never re-split the audience, and correct the subscriber manageLists `target_list_ids` type to an array (the Listmonk v6.2.0 server rejects scalars). Migrate the on-disk store to schema version 2 with backward-compatible v1 reads. Update automation hygiene to wrap targetListId in an array for the corrected manageLists signature. — Thanks @imjlk!
- [39930bf](https://github.com/imjlk/listmonk-ops/commit/39930bf29ac3f563b229eada16f192772424ad17) Add pluggable AbTestStoreAdapter interface with InMemoryAbTestStore and JsonFileAbTestStore implementations, plus revision bumping for optimistic concurrency control. This enables swapping persistence backends (JSON file, Postgres) without changing domain code. — Thanks @imjlk!

### Patch changes

- Updated dependencies: openapi@0.3.1, operations@0.3.1

## 0.3.1 — 2026-07-23

### Added

- [9c1e818](https://github.com/imjlk/listmonk-ops/commit/9c1e81837c354d1718da51f5ef46c515cdbc8f79) Add shared operation catalog discovery for CLI and MCP parity — Thanks @imjlk!

### Changed

- [06c1bd0](https://github.com/imjlk/listmonk-ops/commit/06c1bd090f0ad8f5b5e651408491077730da8cd2) Add graph-enforced direct regression coverage for A/B test CLI input and every shared operation invoker. — Thanks @imjlk!

### Patch changes

- Updated dependencies: common@0.3.0, openapi@0.3.0, operations@0.3.0

## 0.3.0 — 2026-07-21

### Added

- [cf17240](https://github.com/imjlk/listmonk-ops/commit/cf17240e4509c548a82cdf7ee816cdc5954d5352) Expose shared A/B test lifecycle operations across CLI and MCP — Thanks @imjlk!

### Patch changes

- Updated dependencies: operations@0.2.0

## 0.2.0 — 2026-07-20

### Added

- [d227f35](https://github.com/imjlk/listmonk-ops/commit/d227f35985afb8c95472991e579f28569c86afdc) Add schema-aware atomic JSON persistence with recoverable cross-process locks,
  migrate automation stores, and share transactional A/B state across CLI and
  MCP workflows. — Thanks @imjlk!

### Patch changes

- Updated dependencies: common@0.2.0, openapi@0.2.0

## 0.1.3 — 2026-03-14

### Changed

- [b225654](https://github.com/imjlk/listmonk-ops/commit/b225654b985bc3f5601af131dfccb53e53f2f093) Refresh workspace dependencies, add Renovate-based dependency automation, and generate Sampo changesets automatically for dependency PRs that touch releasable packages. — Thanks @imjlk!

### Patch changes

- Updated dependencies: common@0.1.3, openapi@0.1.5

## 0.1.2 — 2026-03-14

### Changed

- [3b22b2c](https://github.com/imjlk/listmonk-ops/commit/3b22b2c455c5883e182702eb0bb7355e52528c91) Mark executable packages as Bun-targeted where applicable, harden automation workflows against empty upstream responses, add atomic rollback to A/B test provisioning, and improve package metadata for library consumers. — Thanks @imjlk!

### Patch changes

- Updated dependencies: common@0.1.2, openapi@0.1.4

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

- Updated dependencies: common@0.1.1, openapi@0.1.3

