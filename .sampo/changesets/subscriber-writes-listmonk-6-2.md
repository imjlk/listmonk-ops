---
npm/@listmonk-ops/operations: patch (Fixed)
npm/@listmonk-ops/mcp: patch (Fixed)
npm/@listmonk-ops/cli: patch (Fixed)
---

Align subscriber writes with Listmonk 6.2. `subscribers.unblocklist` no longer calls `PUT /subscribers/blocklist`, which ignores `action` and blocklisted every requested subscriber (unsubscribing all of their lists) while reporting success; it now returns each blocklisted subscriber to `enabled` individually, leaves other statuses unchanged, and counts successes and failures per subscriber. `subscribers.update` now uses `PATCH`, so a name- or status-only update no longer fails with "Invalid email" or, when an email was passed, wipes list memberships and attributes; `attribs` keys are merged. `list_uuids` are resolved to list IDs because Listmonk accepts but never applies them, and an identical create without a name replays against the server-derived name.
