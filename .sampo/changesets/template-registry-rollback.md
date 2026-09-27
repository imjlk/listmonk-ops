---
npm/@listmonk-ops/automation: patch (Fixed)
npm/@listmonk-ops/operations: patch (Fixed)
npm/@listmonk-ops/mcp: patch (Fixed)
npm/@listmonk-ops/cli: patch (Fixed)
---

Template registry sync now makes the captured live content the active version and records the previously active version as the new capture's rollback predecessor. An unpinned rollback re-reads the live Listmonk template and restores that predecessor, so applying and syncing after promoting an older version returns to the version that was actually active before the edit. A pinned target must be that resolved predecessor; a pin authorizes overwriting live content that drifted outside the registry; and a target without `body_source` is rejected when the live template has one. Listmonk storing a non-transactional template's name as its subject on update no longer reads as drift or forces repeated writes. Unpinned rollback still fails closed with `TemplateRegistryDriftError` when the live content matches neither the active version nor the latest capture; sync first or pin `to_version_id` to authorize the overwrite.
