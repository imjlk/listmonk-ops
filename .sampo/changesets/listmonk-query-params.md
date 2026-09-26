---
npm/@listmonk-ops/openapi: patch (Fixed)
npm/@listmonk-ops/operations: patch (Fixed)
npm/@listmonk-ops/mcp: patch (Fixed)
npm/@listmonk-ops/cli: patch (Fixed)
---

Map list inputs to the query parameters Listmonk 6.2 actually honors. Campaign and subscriber lists now accept `asc`/`desc` in either case and send lowercase, because Listmonk silently sorted uppercase `ASC` descending; the SDK's campaign, subscriber, and list `order` types are now lowercase `asc | desc`.
