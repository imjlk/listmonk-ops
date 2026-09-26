---
npm/@listmonk-ops/automation: patch (Fixed)
npm/@listmonk-ops/operations: patch (Fixed)
npm/@listmonk-ops/cli: patch (Fixed)
npm/@listmonk-ops/mcp: patch (Fixed)
---

Subscriber hygiene now selects only subscribers who still hold a membership Listmonk would deliver to: confirmed on any list, or unconfirmed on a single opt-in list. Opt-in modes are read from the list endpoint and fail closed, with a warning when that skips anyone. Winback can therefore no longer add someone who unsubscribed everywhere to a list that then mails them. Mutations count as applied only on Listmonk's `data: true` acknowledgement, and the list add now sends the `ids` body that Listmonk 6.2 requires. Error responses and missing acknowledgements are reported in a new `failedSubscribers` count with bounded `list_add`/`blocklist` codes such as `http_403` and no remote text. Guard and dry-run timestamps accept the `+09:00`/`+00:00` offsets Listmonk emits. Descriptions now state that "inactivity" is profile `updated_at` staleness, which ignores sends, opens, and clicks, and that sunset blocklisting irreversibly unsubscribes every list membership.
