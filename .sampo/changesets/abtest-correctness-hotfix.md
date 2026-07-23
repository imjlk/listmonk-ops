---
npm/@listmonk-ops/abtest: patch (Fixed)
---

Harden A/B test correctness: exact largest-remainder allocation, paginated UUID-deduped audience resolution, fail-closed metrics collection, status-aware cancel/cleanup planning, and confidence-threshold-driven statistics. Document the Listmonk v6.2.0 API behavior (bulk membership requires target_list_ids as an array, scheduled/draft campaigns cannot be cancelled only deleted, campaign tag filter uses the singular param) that informed these fixes.
