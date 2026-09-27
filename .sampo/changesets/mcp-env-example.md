---
npm/@listmonk-ops/mcp: patch (Fixed)
---

The MCP package's example environment now matches the local stack's token setup (the `api-admin` API user and its token or token file, as created by `bun run stack:bootstrap-auth`) instead of an outdated admin password, and drops an unused `DEBUG` flag.
