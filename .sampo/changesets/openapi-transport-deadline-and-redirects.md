---
npm/@listmonk-ops/openapi: patch (Fixed)
npm/@listmonk-ops/mcp: patch (Fixed)
npm/@listmonk-ops/cli: patch (Fixed)
---

Harden the Listmonk client transport. The per-attempt deadline now stays armed until the response body is read, so a stalled body rejects with a named `TimeoutError` instead of hanging a CLI command or MCP tool call; retried 5xx bodies are cancelled. Writes (`POST`/`PUT`/`PATCH`/`DELETE`) no longer follow redirects and return a `ListmonkRedirectError` instead of a converted `GET` that reports success or a body replayed to another origin. `LISTMONK_TIMEOUT`/`LISTMONK_RETRIES` are validated strictly (`abc` no longer disables every request and `30s` no longer means 30 ms) and now apply to raw-header clients, so the MCP server honors them like the CLI. An explicit `auth` object is never completed from `LISTMONK_USERNAME`/`LISTMONK_API_TOKEN`, readiness reports a non-JSON 200 as `invalid_response`, the Worker runtime rejects a bare trailing `?` or `#` in its base URL, and `createConfig` no longer throws in runtimes without `process`.
