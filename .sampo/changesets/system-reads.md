---
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/cli: minor
---

Added the `system` shared operation family (119 → 121 total descriptors, introduced directly as stable): `system.about` reads the running Listmonk version, build, Go runtime, and host summary (the observed document's database/system/host sections pass through the loose object), and `system.logs` reads the recent server log lines as a JSON array — instance-level diagnostics distinct from the per-import logs. CLI: `listmonk-cli system about` and `system logs [--lines N]` (local tail selection); MCP tools `listmonk_get_about` and `listmonk_get_logs` — the latter replacing the hand-rolled settings-handler tool of the same name with the shared catalog. The stable compatibility baseline was re-accepted (121 contracts) and the spec verb vocabulary gains `about`.
