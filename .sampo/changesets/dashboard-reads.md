---
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/cli: minor
---

Added the `dashboard` shared operation family (111 → 113 total descriptors, introduced directly as stable): `dashboard.counts` reads the installation-level subscriber/list/campaign/message aggregates and `dashboard.charts` reads the daily campaign-view and link-click series, both wrapping the until-now-unused SDK dashboard calls. The observed 6.2 response shapes — nested aggregate counters (with `blocklisted` null until computed, campaign status maps, a bare message count) and `{count, date}` chart buckets — are returned as observed with loose objects for forward compatibility. CLI: `listmonk-cli dashboard counts|charts`; the MCP tools `listmonk_get_dashboard_counts`/`listmonk_get_dashboard_charts` replace the hand-rolled settings-handler tools of the same names with the shared catalog (structured content, read-only safety). The stable compatibility baseline was re-accepted (113 contracts) and the spec verb vocabulary gains `counts` and `charts`.
