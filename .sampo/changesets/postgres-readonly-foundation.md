---
npm/@listmonk-ops/automation: patch
---

Add an internal read-only Postgres inspection foundation for the sequence and webhook runtime schemas: reads run in `BEGIN READ ONLY` transactions with transaction-local statement and lock timeouts, schema state is classified as ok, schema_missing, schema_outdated or schema_unsupported without running DDL, migrations, row writes or advisory locks, and connection failures are reduced to fixed codes that never include the connection string. It is not exported or wired into any command yet; `ops health` and `sequences simulate` still refuse Postgres.
