---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/cli: minor
---

Promote `ops.templates.registry-rollback` from experimental to stable with conditional retry semantics. The rollback accepts an optional `to_version_id` (CLI `--to-version-id`) that pins the target: a pinned repeat already applied reports `rolled_back: false` without another mutation, a registry that moved so the pinned target is no longer reachable fails explicitly, and an unpinned rollback still resolves the previous version dynamically and stays unsafe. The stable TypeScript contract count rises from 82 to 83.
