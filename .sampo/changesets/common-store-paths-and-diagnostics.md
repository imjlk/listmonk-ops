---
npm/@listmonk-ops/common: patch (Fixed)
npm/@listmonk-ops/automation: patch (Fixed)
npm/@listmonk-ops/mcp: patch (Fixed)
npm/@listmonk-ops/cli: patch (Fixed)
---

Resolve the data directory, token files, and every store path override with one rule (trimmed, leading `~` expanded, relative paths from the home directory) so the CLI and MCP server use the same idempotency, audit, and automation state files; reject Listmonk API URLs with a bare `?` or `#`; report the lock file, its owner, and the manual fix when a JSON store lock times out, and detect reused pids that answer EPERM on Linux; name the file, errno code, or requested profile in configuration, token-file, and store read errors; and add `LISTMONK_OPS_TRANSACTIONAL_STORE_MAX_RECORDS` for the file and PostgreSQL transactional stores, whose capacity error now reports retained counts and real remedies.
