---
npm/@listmonk-ops/openapi: minor (Added)
---

Add the tree-shakable `@listmonk-ops/openapi/runtime` entrypoint for Fetch-compatible
services such as Cloudflare Workers. It normalizes Listmonk API origins, creates
HTTPS-only token-authenticated clients, and sends single-recipient external
transactional messages without creating subscribers. Runtime failures expose
bounded error codes, diagnostic reasons, and HTTP status without copying remote
bodies or recipient data. Requests use a configurable 30-second default timeout
and expose aborts and timeouts as ambiguous, non-retry-safe outcomes.
