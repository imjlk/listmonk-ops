---
npm/@listmonk-ops/abtest: minor
npm/@listmonk-ops/operations: minor
npm/@listmonk-ops/mcp: minor
npm/@listmonk-ops/cli: minor
---

Promote `abtest.tick` from experimental to stable with the same echoed-claim-set recovery contract as the other ticks, bound to the pre-tick status. The tick output echoes the claim positions of every non-terminal test it swept (`claim_steps`: test id plus pre-tick status), and an identical retry carrying that echoed set as `recovery_set` (CLI `--recovery-set`) runs a convergent recovery pass over exactly those tests: a member is re-processed only while it still sits at its echoed status — tests that advanced to a later status, completed, or vanished since the echo are skipped as already moved on, and the sweep never touches tests that became due after the original request. Every transition is a status-guarded, time-gated state-machine step with no external at-least-once side effect in the tick path itself, so the recovery case classifies as safe; fresh ticks (without the echoed set) keep the honest unsafe classification because they sweep whatever is non-terminal at request time. Duplicate echoed test ids are rejected up front. The stable TypeScript contract count rises from 90 to 91.
