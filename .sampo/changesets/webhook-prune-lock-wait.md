---
npm/@listmonk-ops/automation: patch
---

Wait for row locks when pruning the exact echoed webhook delivery set. The exact-set branch previously used `FOR UPDATE SKIP LOCKED`, which could silently delete only the unlocked subset of the confirmed set while another transaction held a lock, breaking the advertised retry-is-a-no-op contract; it now waits on locks (plain `FOR UPDATE`) so a destructive prune deletes the full confirmed set or fails. The bounded batch branch keeps `SKIP LOCKED`.
