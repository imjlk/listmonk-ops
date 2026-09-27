---
npm/@listmonk-ops/abtest: patch (Fixed)
npm/@listmonk-ops/mcp: patch (Fixed)
npm/@listmonk-ops/cli: patch (Fixed)
---

Respect source-list consent when resolving A/B test audiences: subscribers who unsubscribed from a source list and unconfirmed members of double opt-in lists are no longer copied onto variant or holdout lists, matching Listmonk's own campaign delivery rule (single opt-in `unconfirmed` members stay eligible). Each source list's opt-in mode is read from `GET /lists/{id}`, and an unreadable list, unknown opt-in mode, or unverifiable membership now fails audience resolution before any list is created. New audience snapshots record `eligibilityPolicyVersion: 2`; stored tests with legacy version 1 snapshots still load.
