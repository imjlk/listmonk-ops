---
npm/@listmonk-ops/abtest: patch (Fixed)
npm/@listmonk-ops/openapi: patch (Changed)
npm/@listmonk-ops/mcp: patch (Fixed)
npm/@listmonk-ops/cli: patch (Fixed)
---

Carry A/B opt-outs to the source lists before cleanup: Listmonk's unsubscribe link only marks the campaign's temporary variant or holdout list, so stop, delete, provisioning rollback, and the legacy cleanup helpers now unsubscribe those members from the test's source lists, confirm it, and only then delete the temporary list. A list whose opt-outs cannot be read, carried, or confirmed, or whose test records no source lists, is kept and reported so the cleanup can be retried, and retries now treat Listmonk 6.2's HTTP 400 "Campaign not found" answer as an already-deleted campaign.
