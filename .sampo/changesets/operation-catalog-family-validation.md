---
npm/@listmonk-ops/operations: patch (Fixed)
npm/@listmonk-ops/mcp: patch (Fixed)
npm/@listmonk-ops/cli: patch (Fixed)
---

Reject an unknown operation family in `operations --family`, `specs search --family`, `listmonk_list_operations`, and `listmonk_schema_search` with the list of known families instead of silently returning no operations, and describe every catalog family in the MCP discovery schema.
