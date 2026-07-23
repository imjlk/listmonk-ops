---
npm/@listmonk-ops/abtest: minor (Added)
npm/@listmonk-ops/openapi: patch (Fixed)
npm/@listmonk-ops/automation: patch (Fixed)
---

Add deterministic SHA-256 assignment and chunked bulk membership to A/B test provisioning so retries and reconciliation never re-split the audience, and correct the subscriber manageLists `target_list_ids` type to an array (the Listmonk v6.2.0 server rejects scalars). Migrate the on-disk store to schema version 2 with backward-compatible v1 reads. Update automation hygiene to wrap targetListId in an array for the corrected manageLists signature.
