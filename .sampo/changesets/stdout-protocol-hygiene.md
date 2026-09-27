---
npm/@listmonk-ops/abtest: patch (Fixed)
npm/@listmonk-ops/automation: patch (Fixed)
npm/@listmonk-ops/mcp: patch (Fixed)
npm/@listmonk-ops/cli: patch (Fixed)
---

Keep MCP stdio and CLI machine-readable stdout free of stray logs: A/B test creation writes its statistical diagnostics to stderr, the Postgres sequence runtime discards server notices and avoids named prepared statements like the webhook runtime, the stdio MCP server routes all console output to stderr, and CLI `--format json|ndjson|quiet` commands capture stray console output as diagnostics.
