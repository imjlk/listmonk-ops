---
npm/@listmonk-ops/operations: patch (Security)
npm/@listmonk-ops/automation: patch (Security)
npm/@listmonk-ops/mcp: patch (Security)
npm/@listmonk-ops/cli: patch (Security)
---

Redact credentials embedded in URL-valued Listmonk settings. `settings.get` returned every string outside a credential-named key verbatim, so the userinfo of a messenger postback `root_url` or a basic-auth `app.root_url` (`https://user:pass@host`), secret query values such as `?api_key=`, `?token=`, an Azure SAS `sig`, or a presigned S3 public URL's `X-Amz-Credential` and `X-Amz-Signature`, and an SMTP or POP URL pasted into a `host` field (`smtps://user:pass@host:465`) reached CLI and MCP output in clear text. Every absolute URL in a string value now has its userinfo and credential-named query and fragment values (such as `#access_token=`) replaced by `[redacted]`, with the rest of the URL kept exactly as written; a userinfo containing unencoded spaces is redacted as a whole, a URL the parser rejects is redacted up to its last `@`, and strings that are not URLs are unchanged. `@listmonk-ops/operations` exports the shared `redactUrlCredentials` helper. `providers.status` and `deliverability.doctor` pass the SMTP hosts and `app.from_email` they echo from settings through the same helper, so an SMTP URL pasted into a host field no longer leaks its credentials there, and the legacy `listmonk_get_server_config` MCP tool redacts the `root_url` and `public_subscription.redirect_urls` that Listmonk 6.2's `/api/config` echoes from settings.
