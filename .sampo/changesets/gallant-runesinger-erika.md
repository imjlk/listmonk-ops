---
npm/@listmonk-ops/openapi: minor
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/cli: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/automation: patch
npm/@listmonk-ops/abtest: patch
---

Separate public connectivity, authenticated API access, and selected scoped collection reads in shared CLI/MCP status diagnostics. Add status --check for automation, bound probe time and response size, and redact target URL secrets and remote error bodies.

Use workspace references for internal OpenAPI dependencies so release planning updates their ranges with the new client version.
