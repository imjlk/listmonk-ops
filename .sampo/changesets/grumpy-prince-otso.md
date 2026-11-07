---
npm/@listmonk-ops/automation: patch (Fixed)
npm/@listmonk-ops/mcp: patch (Fixed)
npm/@listmonk-ops/cli: patch (Fixed)
---

Template registry sync now reads the registry before it lists templates, so an unreadable registry fails a sync without explicit template ids before any Listmonk request, as a sync with explicit ids already did. A rollback pinned over drifted live content whose stored active version is missing from the template's history now reports that missing base version instead of claiming the template has no previous version. `liveTemplateMatchesRemoteHashPin()`, the predicate promotion and rollback use to accept an `expected_remote_hash` pin, is exported beside the other template registry predicates.
