---
npm/@listmonk-ops/automation: patch (Fixed)
npm/@listmonk-ops/mcp: patch (Fixed)
npm/@listmonk-ops/cli: patch (Fixed)
---

Template registry sync now makes the captured live content the active version, and an unpinned rollback re-reads the live Listmonk template and writes the version captured immediately before it, so the apply → sync → rollback flow reverts the synced edit instead of reporting no previous version or skipping a promoted version. Promotions and rollbacks remember the content Listmonk stored for them, so Listmonk turning an empty campaign subject into the template name no longer reads as drift or forces repeated writes. Live content changed outside the registry since the last sync fails closed with `TemplateRegistryDriftError` (sync first or pin `to_version_id`), while pinned rollbacks and their retry semantics are unchanged.
