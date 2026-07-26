---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/cli: patch
npm/@listmonk-ops/mcp: patch
---

Automation security hardening: SSRF defense in preflight link checking (private IP/loopback/metadata blocking, manual redirect revalidation, bounded concurrency), store path redaction from MCP/CLI operation outputs and error messages, template promote optimistic concurrency (expectedRemoteHash + force), and fractional aggregate baselines in segment drift.
