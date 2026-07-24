---
npm/@listmonk-ops/abtest: minor (Added)
---

Add pluggable AbTestStoreAdapter interface with InMemoryAbTestStore and JsonFileAbTestStore implementations, plus revision bumping for optimistic concurrency control. This enables swapping persistence backends (JSON file, Postgres) without changing domain code.
