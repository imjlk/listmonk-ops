---
npm/@listmonk-ops/automation: patch (Security)
npm/@listmonk-ops/mcp: patch (Security)
npm/@listmonk-ops/cli: patch (Security)
---

Harden outbound webhook redaction and campaign preflight link checks. Webhook event data, including provider metadata that is stored in the outbox and forwarded to endpoints, now redacts credential, personal-data, and recipient-address keys in plural, camelCase, snake_case, and kebab-case spellings (such as `apiKeys`, `refresh_tokens`, `subscriberEmails`, and SES `destination`, `source`, `to`, and `from`), along with string values and object keys that contain an email address, while preserving payload structure. Preflight link checks now fail closed when DNS resolution fails, reporting the link as unverifiable without fetching it, and pin every HTTP(S) request and redirect hop to the validated public addresses through the shared webhook transport, so DNS rebinding can no longer reach loopback or cloud metadata addresses; broken-link details no longer echo remote error text. Webhook endpoints that name `localhost.` or `*.localhost` are rejected at create and update time instead of sending every delivery to the dead-letter queue.
