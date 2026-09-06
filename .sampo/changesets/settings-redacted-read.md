---
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/cli: minor
---

Added `settings.get` (stable, 123 → 124 total descriptors): a credential-redacted read of the Listmonk installation settings. The raw document carries SMTP pool passwords, S3 access keys, the SendGrid bounce key, and OIDC client secrets — the legacy hand-rolled `listmonk_get_settings` MCP tool returned all of them unredacted. The shared operation recursively replaces every credential-bearing field (exact and substring name matching covering namespaced keys like `bounce.sendgrid_key` and `upload.s3.aws_secret_access_key`, arrays walked so per-entry SMTP passwords are covered) with `[redacted]` before the document leaves the executor, without mutating the source, while non-secret identifiers like OIDC client ids stay visible for configuration correlation. CLI: `listmonk-cli settings get`; the MCP tool `listmonk_get_settings` now projects the shared redacted operation. The stable baseline was re-accepted (124 contracts) and the settings resource joined the spec vocabulary as the seventeenth shared family.
