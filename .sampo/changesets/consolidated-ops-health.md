---
npm/@listmonk-ops/cli: minor
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/mcp: minor
---

Add a bounded, privacy-minimal read-only ops health report shared by CLI and MCP, with fixed-clock classification, explicit unavailable/Postgres/truncated evidence, safe read suggestions and CLI check exit status. Never recover, claim, send or initialize schema while inspecting health.
