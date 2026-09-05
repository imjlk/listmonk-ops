---
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/cli: minor
---

Added `subscribers.export` (stable, 118 → 119 total descriptors): the complete data-portability export for one subscriber — profile records, list subscription history, campaign views, and link clicks — as returned by the observed Listmonk 6.2 endpoint (a raw export document, not a JSON data envelope; sections pass through as observed with loose objects for forward compatibility). The export is a comprehensive PII read, so the agent guidance points at `subscribers.get` for everything short of an explicit export request. CLI: `listmonk-cli subscribers export --id N`; MCP: `listmonk_export_subscriber`. The stable compatibility baseline was re-accepted (119 contracts) and the spec verb vocabulary gains `export`.
