---
npm/@listmonk-ops/operations: patch
npm/@listmonk-ops/openapi: patch
npm/@listmonk-ops/automation: patch
npm/@listmonk-ops/mcp: patch
npm/@listmonk-ops/cli: patch
---

Redact credentials embedded in URL-valued Listmonk settings. `settings.get` returned every string outside a credential-named key verbatim, so the userinfo of a messenger postback `root_url` or a basic-auth `app.root_url` (`https://user:pass@host`), secret query values such as `?api_key=`, `?token=`, an Azure SAS `sig`, or a presigned S3 public URL's `X-Amz-Credential` and `X-Amz-Signature`, and an SMTP or POP URL pasted into a `host` field (`smtps://user:pass@host:465`) reached CLI and MCP output in clear text. Every absolute URL in a string value now has its userinfo and credential-named query and fragment values (such as `#access_token=`) replaced by `[redacted]`, with the rest of the URL kept exactly as written; a userinfo containing unencoded spaces is redacted as a whole, and a URL the parser rejects is redacted up to its authority-closing `@`. Credential-named parameter assignments in non-URL strings (such as `token=...` or `api_key=...`) are redacted too; other non-URL text is unchanged. `@listmonk-ops/operations` exports the shared `redactUrlCredentials` helper. `providers.status` and `deliverability.doctor` pass the SMTP hosts and `app.from_email` they echo from settings through the same helper, so an SMTP URL pasted into a host field no longer leaks its credentials there, and the legacy `listmonk_get_server_config` MCP tool redacts the `root_url` and `public_subscription.redirect_urls` that Listmonk 6.2's `/api/config` echoes from settings.

Settings updates and SMTP tests made through the shared OpenAPI client reject redacted credential placeholders before sending a request, preventing a read-redact-write or test cycle from using `[redacted]` as a literal credential. Percent-encoded nested URLs and encoded placeholders are handled without rewriting other encoded text, while non-credential query metadata such as `token_type`, `passwordless`, and `monkey` remains visible. Ambiguous spaced credential values are masked to their explicit delimiter or the end of the value.
