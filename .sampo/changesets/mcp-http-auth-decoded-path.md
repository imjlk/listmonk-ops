---
npm/@listmonk-ops/mcp: patch (Security)
---

Enforce the MCP HTTP bearer token on the percent-decoded path the router matches, closing a bypass where encoded paths such as `/%6Dcp` or `/%74ools/call` executed tools without `MCP_HTTP_AUTH_TOKEN`. With a token configured, every route except `GET /health`, `GET /`, and CORS preflights now requires it, including unknown paths, and Host-less HTTP/1.0 requests are rejected as a forbidden host instead of failing with a server error. Malformed legacy REST bodies (invalid JSON, or `/tools/call` without a valid `params.name`) now return a concise 400 instead of a 500 with a logged stack trace, and unknown options or invalid `--port`, `--transport`, or `MCP_SERVER_PORT` values exit with a one-line error pointing to `--help` instead of a stack trace or a silent fallback to port 3000.
