---
npm/@listmonk-ops/abtest: minor
npm/@listmonk-ops/operations: minor
---

Promote `abtest.create` from experimental to stable by making the create intent durable before remote effects. The executor commits the replay key, a canonical request fingerprint, and the full create payload in its own store write before provisioning any campaigns or lists, so an ambiguous retry resumes the same test instead of provisioning duplicates; a completed create replays with `created: false`, and an explicit key reused with a different request conflicts explicitly. Replay keys are derived from the fully defaulted configuration so adapter-equivalent requests hash equally. The stable TypeScript contract count rises from 79 to 80.
