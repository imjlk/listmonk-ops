---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/cli: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/operations: patch
---

`ops health` (CLI `listmonk-cli ops health`, MCP `listmonk_ops_health`) now inspects Postgres-backed sequence and webhook stores instead of reporting them as unsupported. Each store is read through the internal read-only reader in one `REPEATABLE READ, READ ONLY` transaction with statement and lock timeouts: the schema is checked first, then only status and timestamp columns are read with `LIMIT scan_limit` plus exact `count(*)` totals for coverage. The runtime repositories are never opened, so no DDL, migration, advisory lock or row write happens. Missing, outdated or unsupported schemas and unreachable, auth, timeout or permission failures are `unknown` with a sanitized code (for example `schema_outdated` or `postgres_timeout`) and never include the connection string. A dedicated read-only role (USAGE on `listmonk_ops`, SELECT on its tables) is recommended but not required. The `ops.health` operation spec text is updated to match.
