---
npm/@listmonk-ops/abtest: minor
npm/@listmonk-ops/operations: minor
---

Promote `abtest.launch` and `abtest.stop` from experimental to stable with documented no-op repeats. Repeating a recorded launch (a scheduled or running test with `startedAt` set) returns the persisted test instead of rescheduling variant delivery, and repeating a completed stop returns the cancelled test; partial remote cleanup continues to converge because already-cancelled or deleted campaigns and lists are skipped. The stable TypeScript contract count rises from 75 to 77.
