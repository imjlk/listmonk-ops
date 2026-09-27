---
npm/@listmonk-ops/openapi: minor (Changed)
npm/@listmonk-ops/operations: patch (Fixed)
npm/@listmonk-ops/mcp: patch (Fixed)
npm/@listmonk-ops/cli: patch (Fixed)
---

Map list and analytics inputs to the query parameters Listmonk 6.2 actually honors. Campaign and subscriber lists now accept `asc`/`desc` in either case and send lowercase, because Listmonk silently sorted uppercase `ASC` descending; the SDK's campaign, subscriber, and list `order` types are now lowercase `asc | desc`, so TypeScript callers that passed `ASC`/`DESC` to the generated client must switch to lowercase. `media.list` forwards `page`, a positive-integer `per_page`, and a filename `query` to the paginated media endpoint (CLI `--query`) and returns the server's pagination metadata, so files beyond the first 20 are reachable. The generated media response now exposes a page envelope; raw SDK consumers of the former array response should read the new `data.results` field. `campaigns.analytics` sends the inclusive `to` date as the end of that day, so single-day ranges are no longer empty. Subscriber imports accept `unconfirmed`, and the deprecated `pending` status is sent as `unconfirmed` instead of being rejected by Listmonk.
