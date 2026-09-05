---
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/openapi: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/cli: minor
---

Added two stable reads (116 → 118 total descriptors). `subscribers.import.logs` completes the import lifecycle: it reads the raw importer log lines from the most recent session (empty string when none has run), exposed as `listmonk-cli subscribers import-logs` and the `listmonk_get_subscriber_import_logs` MCP tool. `templates.preview` renders the stored template to HTML exactly as campaign content would appear inside it — the observed GET endpoint answers with the rendered document around a dummy campaign body rather than a JSON envelope, and the generated type's spurious request body is absorbed at the wrapper boundary — exposed as `listmonk-cli templates preview --id N` and the `listmonk_preview_template` MCP tool. The stable compatibility baseline was re-accepted (118 contracts) and the spec verb vocabulary gains `logs`.
