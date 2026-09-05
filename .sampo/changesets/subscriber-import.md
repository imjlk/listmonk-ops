---
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/cli: minor
---

Added the asynchronous subscriber import lifecycle (113 → 116 total descriptors, introduced directly as stable): `subscribers.import.start` uploads a CSV (raw text, 1 MiB cap; target lists bounded at 20) through the observed multipart endpoint and starts the background importer — a confirmed, destructive-flagged bulk write whose conditional retry documents that Listmonk upserts rows by email, so repeating an identical CSV converges while a changed one does not; `subscribers.import.status` reads the session progress counters (`name`/`total`/`imported`/`status`, observed states none/importing/stopping/finished); `subscribers.import.stop` sends the stop signal (observed as `DELETE /api/import/subscribers`) and reports the reset session, safe to repeat. CLI: `listmonk-cli subscribers import --mode subscribe --lists 1 --file ./subs.csv --confirm`, `subscribers import-status`, and `subscribers import-stop`; MCP tools `listmonk_start_subscriber_import`, `listmonk_get_subscriber_import_status`, and `listmonk_stop_subscriber_import`. The stable compatibility baseline was re-accepted (116 contracts) and the spec verb vocabulary gains `stop`.
