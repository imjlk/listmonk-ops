---
npm/@listmonk-ops/operations: minor
---

Promote 9 operations from experimental to stable: the five pure-read A/B test operations (list, get, analyze, recommend-sample-size, export-assignment), two safe-retry webhook operations (update, inbound.ingest), and two operational reads (digest.daily, templates.registry-history). All nine use standalone TypeScript contracts with safe retry semantics and read or reversible-write effects. The stable TypeScript contract count rises from 46 to 55.
