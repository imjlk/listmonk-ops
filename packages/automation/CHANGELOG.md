# @listmonk-ops/automation

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

