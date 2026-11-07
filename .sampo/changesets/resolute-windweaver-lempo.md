---
npm/@listmonk-ops/cli: patch (Fixed)
npm/@listmonk-ops/mcp: patch (Fixed)
---

Run the CLI and MCP test subprocesses that replace HOME under the Bun running the tests instead of `bun` from PATH, so a version-manager shim (for example mise) that reads its trust state from the real HOME no longer fails them.
