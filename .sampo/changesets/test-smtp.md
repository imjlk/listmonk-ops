---
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/cli: minor
---

Added `settings.test-smtp` (stable, 127 → 128 total descriptors): delivers a real test message through one candidate SMTP server configuration to a single recipient and returns the server log-buffer lines captured around the attempt — verified against the observed 6.2 endpoint, which takes the server fields and the recipient `email` flattened into one JSON body. The password field is accepted for credential verification only and is never persisted or echoed; the send follows the transactional convention (single explicit recipient, no destructive confirmation gate) with retry honestly classified unsafe because every run sends a real message. CLI: `listmonk-cli settings test-smtp --email r@example.com --host mailpit --port 1025` (full server-option surface); the MCP tool `listmonk_test_smtp` replaces the legacy hand-rolled settings-handler tool with the shared catalog. The stable baseline was re-accepted (128 contracts).
