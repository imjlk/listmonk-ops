---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/cli: minor
---

Harden `ops.templates.registry-rollback` with an optional `to_version_id` pin (CLI `--to-version-id`). A pinned rollback whose target is already the active version reports `rolled_back: false` without another mutation, a registry that moved so the pinned target is no longer the previous version fails explicitly instead of silently rolling elsewhere, and a template with no previous version fails instead of falling back to the penultimate entry. The operation stays experimental: ABA transitions and remote drift outside the registry remain indistinguishable without a source-version pin.
