---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/cli: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/operations: patch
---

`sequences simulate --id` (CLI) and `listmonk_sequences_simulate` with `id` (MCP) now read Postgres-backed sequence state instead of refusing it. The definition (and optional enrollment) `jsonb` document is read by primary key through the internal read-only reader in one `REPEATABLE READ, READ ONLY` transaction with statement and lock timeouts, after a schema check; documents over 4 MiB are refused in SQL. The runtime repository is never opened, so no DDL, migration, advisory or row lock, or row write happens. Documents are parsed exactly like the runtime repository, so results match the file store for the same data. Missing, outdated or unsupported schemas and unreachable, auth, timeout or permission failures are refused with a sanitized code (for example `schema_outdated` or `postgres_timeout`) and never include the connection string. New exports: `resolveSequenceSimulationSource`, `SequenceSimulationSource`, `SequenceSimulationSourceError` and `SequenceOperationContext.simulationSource`. The `sequences.simulate` operation spec text is updated to match.
