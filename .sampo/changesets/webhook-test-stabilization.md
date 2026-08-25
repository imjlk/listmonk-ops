---
npm/@listmonk-ops/automation: minor
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/cli: minor
---

Promote `webhooks.test` from experimental to stable (101 → 102 stable contracts, 2 experimental remaining). The keyed probe's event id derivation is now an HMAC keyed to the endpoint's signing secret instead of an unsalted hash, so delivery-log readers cannot enumerate predictable correlation values offline; the derivation remains bound to the endpoint's configuration revision (a repeat after a URL or secret change tests the new configuration), and a keyed probe now fails fast with `signing_secret_unavailable` when the signing secret cannot be resolved — the dispatch would fail signing without it anyway. A keyed retry still collapses onto the queued delivery via the outbox dedup and replays or resumes it, but delivery itself stays honestly at-least-once: the keyed retry case classifies as reconcile (verified through `webhooks.delivery.list`, with the event-id header enabling receiver deduplication; a pruned original lets a repeat send a fresh probe), while unkeyed probes derive a fresh random event id per attempt and keep the unsafe classification.
