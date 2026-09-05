---
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/cli: minor
---

Added two stable operations (121 → 123 total descriptors). `campaigns.archive` toggles a campaign's public archive page: an idempotent, reversible write — repeating the same value converges, the observed endpoint echoes archive metadata (with the observed quirk that even unknown campaign ids are acknowledged), and the shared contract pins the echoed state with loose passthrough. CLI: `listmonk-cli campaigns archive --id N --archive=true`; MCP: `listmonk_archive_campaign`. `subscribers.send-optin` resends the double opt-in confirmation email to one subscriber: a single-recipient real delivery following the transactional-send convention (no destructive confirmation gate) with retry honestly classified unsafe because every run re-sends. CLI: `listmonk-cli subscribers send-optin --id N`; MCP: `listmonk_send_optin`. The stable baseline was re-accepted (123 contracts) and the spec verb vocabulary gains `archive` and `send-optin`.
