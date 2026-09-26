---
npm/@listmonk-ops/operations: patch (Fixed)
npm/@listmonk-ops/automation: patch (Fixed)
npm/@listmonk-ops/mcp: patch (Fixed)
npm/@listmonk-ops/cli: patch (Fixed)
---

Keep idempotency keys reusable when Listmonk is unreachable, and recognize Listmonk 6.2's not-found answers. The generated client returns transport failures as an error envelope without an HTTP response, so keyed `lists.create`, `campaigns.create`, `campaigns.clone`, `templates.create`, and `media.upload` classified a refused connection as ambiguous and burned the key as unresolved; a proven pre-dispatch failure now releases the claim like a 4xx answer. Listmonk 6.2 answers a missing template, campaign, list, subscriber, or bounce with HTTP 400 and a "not found" message (only media uses 404), so `templates.delete` could not report an already-deleted template as `deleted: false` and sequences did not cancel enrollments whose subscriber was deleted; a 400 with a not-found message now counts as a miss.
