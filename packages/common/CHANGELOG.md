# @listmonk-ops/common

## 0.3.0 — 2026-07-23

### Added

- [b52b7f1](https://github.com/imjlk/listmonk-ops/commit/b52b7f1fa9e3a34c4c3c99e70eca7a2b094d38c1) Add execution policy metadata and atomic operation audit storage — Thanks @imjlk!

## 0.2.0 — 2026-07-20

### Added

- [d227f35](https://github.com/imjlk/listmonk-ops/commit/d227f35985afb8c95472991e579f28569c86afdc) Add schema-aware atomic JSON persistence with recoverable cross-process locks,
  migrate automation stores, and share transactional A/B state across CLI and
  MCP workflows. — Thanks @imjlk!

## 0.1.3 — 2026-03-14

### Changed

- [b225654](https://github.com/imjlk/listmonk-ops/commit/b225654b985bc3f5601af131dfccb53e53f2f093) Refresh workspace dependencies, add Renovate-based dependency automation, and generate Sampo changesets automatically for dependency PRs that touch releasable packages. — Thanks @imjlk!

## 0.1.2 — 2026-03-14

### Changed

- [3b22b2c](https://github.com/imjlk/listmonk-ops/commit/3b22b2c455c5883e182702eb0bb7355e52528c91) Mark executable packages as Bun-targeted where applicable, harden automation workflows against empty upstream responses, add atomic rollback to A/B test provisioning, and improve package metadata for library consumers. — Thanks @imjlk!

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

