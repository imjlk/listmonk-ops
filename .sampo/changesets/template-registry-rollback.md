---
npm/@listmonk-ops/automation: patch (Fixed)
npm/@listmonk-ops/mcp: patch (Fixed)
npm/@listmonk-ops/cli: patch (Fixed)
---

Template registry sync now makes the captured live content the active version, and an unpinned rollback re-reads the live Listmonk template and writes the version captured immediately before it, so the apply → sync → rollback flow reverts the synced edit instead of reporting no previous version or skipping a promoted version. Listmonk storing a non-transactional template's name as its subject on update no longer reads as drift or forces repeated writes, and promotions and rollbacks refuse to write a version without a `body_source` over a live template that has one, since Listmonk would keep the live source. Live content changed outside the registry since the last sync fails closed with `TemplateRegistryDriftError` (sync first or pin `to_version_id`), while pinned rollbacks and their retry semantics are unchanged.
