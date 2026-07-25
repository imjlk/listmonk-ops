---
npm/@listmonk-ops/abtest: minor (Added)
---

Add experiment collision guard: installation-scoped HMAC subject keys, active-window overlap detection, and an atomic check-and-reserve participation store with block/exclude/warn policies. Prevents overlapping experiments in the same family from exposing the same subscribers without leaking PII in conflict errors.
