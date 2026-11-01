---
npm/@listmonk-ops/abtest: minor (Added)
npm/@listmonk-ops/operations: minor (Added)
npm/@listmonk-ops/mcp: minor (Added)
npm/@listmonk-ops/cli: minor (Added)
---

Added the stable `abtest.sync-optouts` operation (137 → 138 described operations). It carries opt-outs recorded on A/B temporary lists to the tests' source lists on demand, for one test (including a deleted test whose record is kept for the sync) or every tracked test, ignoring the tick's cadence, and records what it carried so it is never carried twice. `dry_run` previews what would be carried with reads only. It is a confirmed, audited, previewable audience suppression. CLI: `listmonk-cli abtest sync-optouts [--test-id <id>] [--dry-run] --confirm`, which warns about each list it could not carry and exits 1 when one failed; MCP: `listmonk_abtest_sync_optouts`.
