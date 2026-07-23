# @listmonk-ops/cli

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

