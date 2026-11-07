---
npm/@listmonk-ops/abtest: patch (Fixed)
npm/@listmonk-ops/operations: patch (Changed)
npm/@listmonk-ops/mcp: patch (Fixed)
npm/@listmonk-ops/cli: patch (Fixed)
---

Carry A/B opt-outs from temporary lists that are kept, not only from lists about to be deleted: a completed test's variant lists and the holdout list its winner went to, lists a stop keeps for cancelled or finished campaigns, and the lists of a deleted terminal test keep recording opt-outs from those campaigns' unsubscribe links. `abtest tick` now carries them after its progression sweep (at most hourly while a test is active and for 30 days after it ends, then at most daily for as long as a list exists; a dry run previews it and the output reports it as `opt_out_sync`), stop carries the lists it keeps, and deleting a terminal test carries its opt-outs first, fails closed, and keeps a hidden record so its lists keep being synced until they are deleted in Listmonk. Each carried opt-out is recorded and never carried again, so a person who re-subscribes to a source list stays subscribed, and a source membership created after the opt-out is left alone; a stop or delete that fails part-way keeps that record. The first tick after upgrading carries the backlog earlier versions left on kept lists. `abtest.stop`, `abtest.delete`, and `abtest.tick` now declare the audience suppression they perform, and the tick output gains the optional `opt_out_sync` field.

Reconcile shared-source opt-outs with persisted, read-confirmed remote timestamp checkpoints; preserve newer opt-outs, fail closed on unknown legacy chronology, retain required replay history, and omit private progress from public test output.

Preserve PostgreSQL microseconds when deciding whether a source membership was created after an opt-out, including equivalent timezone offsets.

Reconcile a lone test's own partial source-list confirmations before stop or non-terminal deletion; preserve fresh consent and block cleanup when remaining propagation or chronology cannot be confirmed.

Record per-source confirmations during cleanup itself, including partial failures, so a later stop/delete retry or automatic sync cannot revoke renewed consent on an already-carried source.
