---
npm/@listmonk-ops/abtest: minor
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/mcp: minor
---

Make the A/B test create intent durable before remote provisioning. The executor commits the replay key, a canonical request fingerprint (normalized defaults, deterministic placeholders, versioned derivation), and the full create payload in its own store write before provisioning any campaigns or lists, so an ambiguous retry resumes the same test instead of provisioning duplicates, a completed create replays with `created: false`, and an explicit key reused with a different request conflicts explicitly. Launch and stop are blocked while an intent is still provisioning, and legacy records without an intent payload replay as completed creations. `abtest.create` stays experimental until remote resource ids are checkpointed or reconciled on resume.
