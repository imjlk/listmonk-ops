---
npm/@listmonk-ops/mcp: patch (Fixed)
---

Isolate MCP E2E CLI and MCP subprocesses from shared connection profiles and operator state, and fail every E2E file before the first request unless the resolved target is loopback.
