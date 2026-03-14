---
npm/@listmonk-ops/cli: patch (Changed)
npm/@listmonk-ops/common: patch (Changed)
npm/@listmonk-ops/abtest: patch (Changed)
npm/@listmonk-ops/mcp: patch (Changed)
---

Expand package publishability and release ergonomics across CLI/MCP-related workspaces.

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
  - runtime CLI flags for explicit Listmonk endpoint/auth config
