# @listmonk-ops/automation

## 0.8.0 — 2026-08-25

### Minor changes

- [a9a3b3a](https://github.com/imjlk/listmonk-ops/commit/a9a3b3a5db86d5a1a24d4adac601611d8f54e082) Promote `sequences.update` from experimental to stable with conditional retry semantics: a repeat whose requested steps the latest revision already carries (resolved name and description match, recursive canonical step comparison) reports `updated: false` without appending an equivalent revision, in both the file and Postgres stores, while a superseded repeat appends a new revision and stays unsafe. `sequences.enroll` gains conflict-replay machinery — an ambiguous retry replays a provably untouched enrollment (pending, never attempted, never transitioned, same pinned revision, matching context and activation time, resolved with server-side subscriber filtering) as `created: false` — but stays experimental because a terminal enrollment lets the same request start a fresh lifecycle. Replayed updates and enrollments emit no lifecycle webhook events. The stable TypeScript contract count rises from 81 to 82. — Thanks @imjlk!
- [29a4cb4](https://github.com/imjlk/listmonk-ops/commit/29a4cb4f38ed78ea40309a8cfa52631f207dc4d9) Promote `sequences.enroll` from experimental to stable (102 → 103 stable contracts, 1 experimental remaining). The enroll input gains an `expected_prior_enrollments` generation guard (CLI `--expected-prior-enrollments`): the caller echoes the number of enrollments — any status — that already existed for the sequence and subscriber, observed via `sequences.enrollments.list`. The repository's `createEnrollment` verifies the count inside the store transaction (file store and Postgres), so concurrent guarded retries cannot double-create. A guarded ambiguous retry then converges across the whole lifecycle: it creates only while the count still matches, replays the single landed enrollment as `created: false` even after it reached a terminal status (closing the re-entry hazard that kept the operation experimental — an unguarded repeat restarts a terminal lifecycle), and conflicts when more than one enrollment landed or the landed one carries a different context. Intentional re-enrollment stays explicit: a request without the guard still starts a fresh lifecycle after a terminal enrollment, and that case keeps the honest non-idempotent classification. — Thanks @imjlk!
- [29af473](https://github.com/imjlk/listmonk-ops/commit/29af473b254f042a7c5ec686e6d00820987b4a02) Promote `ops.subscribers.hygiene` from experimental to stable — the final experimental descriptor (103 → 104 stable contracts, 0 experimental remaining). The dry run now reports each selected subscriber's raw `updated_at` observation as a `subscriberUpdatedAt` array parallel to `subscriberIds`, and the destructive echo pairs them in order as `subscriber_guards` (CLI `--subscriber-guards`), validated to cover exactly the echoed `subscriber_ids`. Listmonk advances `updated_at` on the very mutations the workflow performs — list adds and blocklisting — so the guard is the durable per-subscriber completion signal the spec's graduation criterion asked for: a guarded destructive retry skips subscribers its own first attempt already touched and ones that changed or re-entered eligibility externally (reported as `skippedGuarded`), while untouched members of the echoed set still run. Retry semantics are conditional and honest: dry runs are trivially safe, a destructive run with the full guard set classifies as reconcile (Listmonk offers no conditional mutation, so the guard is a check-then-act read verified through subscribers.list; a partially applied subscriber recovers through a fresh dry run while already-present list membership is skipped structurally, and a missing updated_at fails the run instead of fabricating a token), and a destructive run without guards keeps the unsafe classification because a re-eligible subscriber would receive a new effect. — Thanks @imjlk!
- [a8a9012](https://github.com/imjlk/listmonk-ops/commit/a8a901201b8cd9a21fa92fc16272dee273c31906) Harden `ops.templates.registry-rollback` with an optional `to_version_id` pin (CLI `--to-version-id`). A pinned rollback whose target is already the active version reports `rolled_back: false` without another mutation, a registry that moved so the pinned target is no longer the previous version fails explicitly instead of silently rolling elsewhere, and a template with no previous version fails instead of falling back to the penultimate entry. The operation stays experimental: ABA transitions and remote drift outside the registry remain indistinguishable without a source-version pin. — Thanks @imjlk!
- [f96b71d](https://github.com/imjlk/listmonk-ops/commit/f96b71d26514608212c5ee108ea71e6637e3103a) Let segment drift snapshots deduplicate by an explicit sampling period. `ops segment-drift` (and the `ops.segments.drift` operation) accepts `--sample-key`: snapshots sharing a list ID and sample key replace their predecessor instead of appending, and same-key snapshots are excluded from the comparison baseline, so an ambiguous retry never double-weights the period. The output reports how many snapshots the run replaced. Unkeyed runs keep the previous append semantics. — Thanks @imjlk!
- [17fcb4f](https://github.com/imjlk/listmonk-ops/commit/17fcb4fea93bfa3541a8dd81886e8eb57c4d981d) Promote five operations from experimental to stable (96 → 101 stable contracts, 3 experimental remaining). `abtest.run` classifies conditionally: with both revision guards (`expected_status` + `expected_updated_at`) an identical retry converges — the guards are verified inside the store transaction, a moved test conflicts, and a terminal test is a documented no-op. `abtest.deploy-winner` becomes retry-safe through tag adoption: a retry adopts the single campaign tagged `winner:deployed` for the test — validating its `variant:<id>` tag against the freshly analyzed winner, rejecting ambiguous or duplicate tagged campaigns, and finishing an interrupted auto-launch before completing — instead of creating a second holdout delivery. `webhooks.dispatch` gains the tick's attempt-bound `recovery_set` contract (CLI `--recovery-set`, capped at 100 entries like the dispatch limit; recovery mode sizes the effective limit to the echoed set): an echoed retry claims exactly the originally claimed deliveries at their originally claimed attempt counts, though delivery itself honestly stays at-least-once (reconcile classification). A dispatch that fails mid-batch after issuing POSTs now surfaces its claimed positions as structured error details — the same `recovery_set` shape — through `WebhookDispatchFailureError`, so an ambiguous retry can echo exactly that set instead of claiming new due work. `ops.templates.registry-promote` promotes with conditional semantics — its `expected_remote_hash` pin conflicts on any intervening remote change (another operator's promotion included) instead of overwriting it, an already-current target is a `promoted: false` no-op that issues no write or head-revision advance, and an unpinned or forced retry keeps the honest unsafe classification — and `ops.templates.registry-rollback` accepts a `from_version_id` source pin, an `expected_head_revision` pin over a new monotonic registry-head counter (every registry-managed write advances it — a same-version re-promotion that restores drifted remote content included — so an A → X → A cycle that restores both the version id and the remote hash still conflicts), and an `expected_remote_hash` remote-drift pin — all verified inside the store lock. An already-applied rollback is a no-op only when the remote actually carries the target content; a target that drifted away while staying active is repaired by re-promoting it. Because Listmonk offers no conditional update the hash pins stay best-effort, and because a successful promote or rollback changes the remote hash and advances the head, a pinned retry of the original request conflicts even after its own success — that conflict is the documented reconciliation signal (`reconcileWith: templates.get`), which is why both pinned cases classify as reconcile rather than safe; any pin-less retry keeps the honest unsafe classification. Registry promote/rollback/history outputs now expose the `headRevision` counter for echoing. — Thanks @imjlk!
- [8561554](https://github.com/imjlk/listmonk-ops/commit/85615549255566c3a7c7a54683254a2cc82c887b) Make webhooks.prune destructive runs delete exactly the echoed delivery set and promote the operation from experimental to stable. Dry runs now report the eligible delivery ids alongside the `before` cutoff, and destructive (non-dry-run) calls must echo both — so a confirmed deletion can never drift with the clock and an automatic retry deletes nothing new. The CLI exposes the set as `webhooks prune --ids` (comma-separated, required with `--no-dry-run`). The stable TypeScript contract count rises from 70 to 71. — Thanks @imjlk!
- [439f2bc](https://github.com/imjlk/listmonk-ops/commit/439f2bc9fbcf28ce3c6d58b75661d55d827e4c88) Give `webhooks.test` keyed-probe deduplication. A probe keyed by `correlation_id` derives a deterministic event id from the endpoint and correlation id, so the outbox dedup collapses an identical retry onto the already-queued delivery; the replay resolves the persisted delivery directly by event (both stores), resumes a still-claimable or lease-expired record, reports a terminal one as `replayed: true` with a consistent skipped summary, and rejects probes whose endpoint is disabled or missing. The operation stays experimental: a retry or expired lease whose first attempt already reached the endpoint redelivers the ping. — Thanks @imjlk!
- [722b77f](https://github.com/imjlk/listmonk-ops/commit/722b77fa3e0305ca2335cbec7f38be4b641e9e1a) Give `ops.subscribers.hygiene` echoed candidate sets. The input accepts an optional `subscriber_ids` set (CLI `--subscriber-ids`, strictly parsed; required when `dry_run` is false, enforced both at the operation boundary and in the exported workflow): destructive runs process exactly the echoed set, subscribers that left the eligible set are skipped, echoed sets larger than the effective limit are rejected instead of truncated, and winback additions are per-subscriber idempotent memberships. The operation stays experimental — a subscriber that re-enters eligibility is re-selected by the identical echoed request, the same re-entry hazard that keeps dead-letter replay experimental. — Thanks @imjlk!
- [132c2d6](https://github.com/imjlk/listmonk-ops/commit/132c2d6779fa9564b9dc9ab93d242bc0cd9d9db7) Promote `webhooks.test` from experimental to stable (101 → 102 stable contracts, 2 experimental remaining). The keyed probe's event id derivation is now an HMAC over a server-generated high-entropy probe id key persisted with the webhook store — the file store's `probeIdKey` field or the Postgres `webhook_runtime_meta` table, created lazily on first use — giving key separation from every endpoint signing credential: probe identity is decoupled from the signing secret, and a low-entropy signing secret cannot be brute-forced from known probe message/id pairs. The derivation remains bound to the endpoint's configuration revision (a repeat after a URL or secret change tests the new configuration), and a keyed probe now fails fast with `signing_secret_unavailable` when the signing secret cannot be resolved or is blank — the dispatch would fail signing without it anyway — without disclosing the secret reference in the message. A keyed retry still collapses onto the queued delivery via the outbox dedup and replays or resumes it, but delivery itself stays honestly at-least-once: the keyed retry case classifies as reconcile (verified through `webhooks.delivery.list`, with the event-id header enabling receiver deduplication; a pruned original lets a repeat send a fresh probe), while unkeyed probes derive a fresh random event id per attempt and keep the unsafe classification. Upgrades are bridged: a keyed retry whose probe was queued by the previous (pre-HMAC) release first resolves the legacy unsalted derived id for the same endpoint, correlation id, and configuration revision and converges onto that delivery, so the migration cannot queue a second probe that also POSTs. The unsalted `testEventUuid` helper is retained as deprecated; the operation derives with the new `keyedTestEventUuid`. — Thanks @imjlk!
- [28989aa](https://github.com/imjlk/listmonk-ops/commit/28989aa6bd35b3c6aebaa922dfc9a8c7156f3f93) Promote `ops.segments.drift` from experimental to stable with conditional retry semantics. A completed keyed sample now replays from the store — an identical retry returns the originally committed measurement without fetching live counts or overwriting the period's sample — while unkeyed snapshots stay unsafe appends, matching the established `transactional.send` conditional precedent. `webhooks.delivery.retry` gains a pending no-op (a repeat while the delivery is still queued reports `retried: false` without another mutation, in both the file and Postgres stores) but stays experimental because a dispatcher can complete the pending delivery first, letting a repeat start another delivery cycle. Dead-letter replay aggregation now skips concurrent no-op requeues so the replayed count stays honest. The stable TypeScript contract count rises from 80 to 81. — Thanks @imjlk!
- [82d5cec](https://github.com/imjlk/listmonk-ops/commit/82d5cec57910ed07b8c362ea53396c856729f466) Apply the prune echo pattern to `webhooks.dlq.replay`. The input accepts an optional `delivery_ids` set (CLI `--delivery-ids`, required with `--no-dry-run`, modeled as a discriminated contract union): destructive runs requeue exactly the echoed dead-letter set and records that already left the dead-letter set are skipped in both the file and repository paths, so an identical retry replays nothing new. The operation stays experimental — a worker can re-exhaust a replayed record before the retry, making the identical echoed request eligible again. — Thanks @imjlk!
- [052f956](https://github.com/imjlk/listmonk-ops/commit/052f9566660f7b74e224d2afe02c4e05b899f8ee) Promote `webhooks.tick` from experimental to stable with the same echoed-claim-set recovery contract as `sequences.tick`, bound to the originally claimed attempt count. Webhook delivery stays honestly at least once in every mode: the echoed set bounds a retry to the originally claimed records (never new due work), but the POST itself can still duplicate an accepted-but-unobserved attempt, so both retry cases classify as reconcile with the stable event-id header available for cooperative receiver deduplication. The tick's dispatch output echoes the exact claimed deliveries with their attempt counts at claim (`claim_steps`), and an identical retry carrying that echoed set as `recovery_set` (CLI `--recovery-set`) runs a convergent recovery pass over exactly those positions: an entry is re-claimed only while its current attempt count still matches the echo — a delivery anyone has attempted since, already succeeded or exhausted, holding a live lease, sitting in backoff, or facing an open circuit is skipped, with the retryable ones reported as `pending_ids` — so the retry never claims new due work and never delivers past the originally claimed position. The reconcile phase of the tick remains idempotent lease maintenance. File and PostgreSQL webhook stores gain attempt-count binding on targeted claims, and fresh ticks (without the echoed set) keep the honest at-least-once reconcile classification. The stable TypeScript contract count rises from 89 to 90. — Thanks @imjlk!
- [b5776c2](https://github.com/imjlk/listmonk-ops/commit/b5776c2970d29cc4e37ffe1a26be959dd9bb7c4f) Promote the purely local-store creates with documented replay semantics. `webhooks.create` and `sequences.create` replay an identically configured existing name as `created: false` (a conflicting configuration under the same name still fails explicitly). `abtest.create` accepts an optional `idempotency_key` (CLI `--idempotency-key`) that is derived from the request when omitted and resolves the replay inside one serialized write, but stays experimental until the key is durable before remote campaign provisioning. The stable TypeScript contract count rises from 77 to 79. — Thanks @imjlk!
- [4ad67d5](https://github.com/imjlk/listmonk-ops/commit/4ad67d590a53eed4ec89c9466448a55b4aa08e88) Harden webhooks.prune deletion windows. The prune input now accepts an optional explicit `before` cutoff — RFC 3339 timestamps with timezone offsets included — and destructive (non-dry-run) calls are required to echo the cutoff a dry run reported, so a confirmed deletion window can never drift with the clock. The CLI exposes the same cutoff as `webhooks prune --before`, which takes precedence over `--older-than-days`. Bounded retries are now documented honestly as continuing with the next oldest batch inside the confirmed window, so the operation stays experimental with reconcile-style retry metadata. — Thanks @imjlk!
- [7c85f96](https://github.com/imjlk/listmonk-ops/commit/7c85f964b9872be831bc84701a2a8db50d3d7b2f) Promote the four remaining delete operations from experimental to stable by making an already-deleted resource a documented no-op: `webhooks.delete`, `sequences.delete`, and `abtest.delete` now report `deleted: false` instead of surfacing not-found errors on repeats, and `templates.delete` distinguishes Listmonk's shared "non-existent or default template" rejection so only a genuinely missing template becomes a no-op while the protected default template still fails explicitly. The webhook and sequence delete outputs make the echoed record optional when nothing was deleted. The stable TypeScript contract count rises from 71 to 75. — Thanks @imjlk!
- [4e4e24f](https://github.com/imjlk/listmonk-ops/commit/4e4e24f9c1783c2a7b658be6084290b7ae72459c) Promote `webhooks.delivery.retry` and `webhooks.dlq.replay` from experimental to stable with generation-bound retries. `webhooks.delivery.retry` accepts an optional `expected_manual_retry_count` (CLI `--expected-manual-retry-count`) — the delivery's pre-request generation echoed from a prior retry's retry_generation output (not the post-retry manual_retry_count, which is already incremented) — and a repeat bound to it only fires while the delivery still sits at that generation: a generation-bound repeat while the original retry's pending state holds (pending count = echo + 1) is rejected with a conflict (the echo was consumed by the still-in-flight effect), an unechoed repeat while pending reports `retried: false`, and a delivery a dispatcher already completed and returned to retry moved to a later generation and is reported unmodified instead of starting another delivery cycle. `webhooks.dlq.replay` echoes each candidate dead letter's generation (`replayed_generations`) and accepts it back as `recovery_generations` (CLI `--recovery-generations`): a record is replayed only while it is still exhausted at its echoed manual retry count, so a record a worker re-exhausted after the replay — the re-entry hazard that kept the replay experimental — is skipped rather than replayed again. Both stores implement the generation filters (in-transaction in PostgreSQL). Unechoed retries keep the honest reconcile classifications. The stable TypeScript contract count rises from 94 to 96. — Thanks @imjlk!
- [ce47668](https://github.com/imjlk/listmonk-ops/commit/ce47668fae41670d09518cdf87d1ae2f9c3e133e) Promote the three reconcile operations from experimental to stable with an echoed-scanned-set recovery contract. `sequences.reconcile`, `webhooks.reconcile`, and `abtest.reconcile` each echo the exact record ids their scan considered (`scanned_ids`), and an identical retry carrying that echo as `recovery_set` re-examines exactly that batch: leases already recovered by the original call are no longer expired and are skipped, drift already repaired no longer matches its repair condition, and the retry never selects the next backlog batch — so it converges over the echoed set. The sequences ambiguous-send resolution mode is independently convergent (it requires the enrollment to still be in the ambiguous status, so a retry after a completed resolution is rejected rather than re-applied). File and PostgreSQL sequence stores gain an enrollmentIds bound on the expired-lease scan; the webhook reconcile gains a deliveryIds bound in both stores; the A/B reconcile filters its examination to the echoed test ids and rejects duplicate echoed ids. Fresh scans (without the echoed set) keep the honest reconcile/unsafe classifications because a bounded scan selects the next backlog batch after an ambiguous result. The stable TypeScript contract count rises from 91 to 94. — Thanks @imjlk!
- [85c6cd7](https://github.com/imjlk/listmonk-ops/commit/85c6cd72ba578dcf40ab59d037694db75df8bc6d) Promote `sequences.tick` from experimental to stable with a step-bound echoed-claim-set recovery contract. The tick output echoes the exact claimed enrollments with their originally claimed steps (`claimed_steps`), and an identical retry carrying that echoed set as `recovery_set` runs a convergent recovery pass over exactly those positions: an entry is re-claimed only while it still sits at its originally claimed step, while members that already advanced to a later step, completed, turned ambiguous, or hold a live lease are skipped — so the retry never claims new due work, ambiguous members stay untouched until an operator reconciles them, and repeated retries converge (transactional idempotency still prevents duplicate sends for re-executed steps). File and PostgreSQL sequence stores gain a `claimSpecific` repository operation (deterministic lock order in PostgreSQL), the CLI tick command accepts a JSON `--recovery-set`, a failed tick surfaces its claim set on the error (`SequenceTickFailureError`) for exactly this recovery, and persisted legacy worker summaries parse with an empty claim set. Skipped members still at their claimed step under a live lease are reported as pending_ids (retryable after lease expiry) instead of being folded into already_done, a failed tick surfaces its claim set as structured error details on the operation error (serialized by the MCP error boundary), and fresh ticks (without the echoed set) keep the honest reconcile classification because they claim whatever is due at request time. The stable TypeScript contract count rises from 88 to 89. — Thanks @imjlk!

### Patch changes

- [12574f7](https://github.com/imjlk/listmonk-ops/commit/12574f7c970c6f7dc22f9753fa8aa29f7e34cb2e) Harden two persistence boundaries left open by review on the recent stabilization batches. Segment drift sample keys are now rejected before writing when they exceed the published 200-trimmed-character contract, and persisted overlength keys are rejected when the store is read. The A/B test store validates `provisionedAt` as a real timestamp instead of any string. — Thanks @imjlk!
- [8a8d7e1](https://github.com/imjlk/listmonk-ops/commit/8a8d7e143f1fd006346e5d1838b557430f92de5e) Wait for row locks when pruning the exact echoed webhook delivery set. The exact-set branch previously used `FOR UPDATE SKIP LOCKED`, which could silently delete only the unlocked subset of the confirmed set while another transaction held a lock, breaking the advertised retry-is-a-no-op contract; it now waits on locks (plain `FOR UPDATE`) so a destructive prune deletes the full confirmed set or fails. The bounded batch branch keeps `SKIP LOCKED`. — Thanks @imjlk!
- [4f03e2d](https://github.com/imjlk/listmonk-ops/commit/4f03e2d84b29a89e3f27638b496bb04b50e5a5dc) Promote `subscribers.create` from experimental to stable with documented email-conflict replay, verified against the local Listmonk 6.2 stack (duplicate email returns 409 while duplicate list and template names both create new records). A retry after an ambiguous create now replays the persisted subscriber as `created: false` when it matches every observable create effect (email, name, status, sorted list memberships, canonical attributes — resolved with server-side email filtering); a conflicting configuration under the same email stays an explicit error. The MCP tool output gains the `created` envelope, and the CLI distinguishes an existing subscriber from a fresh create. Also hardens the segment drift store read to reject whitespace-only persisted sample keys. The stable TypeScript contract count rises from 79 to 80. — Thanks @imjlk!
- Updated dependencies: common@0.6.0, openapi@0.7.1, operations@0.15.0

## 0.7.0 — 2026-08-13

### Fixed

- [1e4644c](https://github.com/imjlk/listmonk-ops/commit/1e4644c3a57b3e08924bc2bc86b7e3a7fd5aa32f) Validate transactional From overrides as one mailbox across shared sends and sequence definitions, and align the published sender, messenger, and subject contracts with runtime parsing. — Thanks @imjlk!

### Added

- [7f8d7bd](https://github.com/imjlk/listmonk-ops/commit/7f8d7bd1190e34639c5a26b1a6a18cb55b47428f) Complete transactional messenger, subject, content-type, and multipart plain-text option parity across the Workers runtime, shared operations, CLI, MCP, and sequence automation. — Thanks @imjlk!

### Patch changes

- Updated dependencies: openapi@0.7.0, operations@0.14.0

## 0.6.0 — 2026-08-08

### Minor changes

- [c12abb0](https://github.com/imjlk/listmonk-ops/commit/c12abb00c54378c5fb5a7f4930708cc63db91cfc) Migrate all 12 remaining A/B test operations from runtime-operation bridge snapshots to standalone TypeScript/Typia product contracts. The experimental runtime bridge count drops from 13 to 0, completing the full bridge-to-standalone migration. All 104 shared operations now use standalone TypeScript contracts authored with Typia. — Thanks @imjlk!
- [4724554](https://github.com/imjlk/listmonk-ops/commit/4724554ce14b3abff61ec521b6e6cb7d058846e3) Migrate all six remaining ops workflow operations (deliverability-guard, subscriber-hygiene, registry-sync, registry-history, registry-promote, registry-rollback) from runtime-operation bridge snapshots to standalone TypeScript/Typia product contracts, reducing the experimental runtime bridge count from 19 to 13. The ops workflow family is now fully standalone. — Thanks @imjlk!
- [4cbc4c3](https://github.com/imjlk/listmonk-ops/commit/4cbc4c3634db726d939b029afbf0039200f5a92e) Migrate `ops.segments.drift` and `ops.digest.daily` from runtime-operation bridge snapshots to standalone TypeScript/Typia product contracts, reducing the experimental runtime bridge count from 21 to 19. — Thanks @imjlk!

### Fixed

- [910b58d](https://github.com/imjlk/listmonk-ops/commit/910b58d8ed67e24deeddfe58ed598cb1d0ca2889) Require confirmation for the deliverability guard's pause path, align threshold schemas, and correct subscriber hygiene retry guidance. — Thanks @imjlk!

### Patch changes

- Updated dependencies: operations@0.13.0

## 0.5.0 — 2026-08-06

### Minor changes

- [26d6689](https://github.com/imjlk/listmonk-ops/commit/26d6689c1a85dda55eae733bf46ad34d63254ab8) Correct the retry semantics on `webhooks.reconcile`: the operation was described as a safe idempotent no-op, but reconciliation is bounded by a per-call limit and an ambiguous retry can select and mutate the next batch of expired deliveries. Switch retry to `kind: "reconcile"` with `idempotent: false`, align the runtime operation's `idempotentHint`, and update the agent retry guidance to verify the remaining backlog in dry-run mode before retrying. The operation stays `experimental` pending a request-level idempotency guarantee. Both operations and automation are released together because the runtime adapter's safety hint and the spec must stay in sync at module initialization. — Thanks @imjlk!
- [b620e60](https://github.com/imjlk/listmonk-ops/commit/b620e60f9576a3a5f66e5707c9e3bb9d1d2db212) Promote `webhooks.circuit.reset` from `experimental` to `stable`. Short-circuit both the file and Postgres repositories so resetting an already-closed circuit with zero failures is a true no-op that does not replace the runtime record, matching the spec's idempotent retry claim. Preserve file-backed success and failure history across reset results, and lock the Postgres endpoint row before deciding whether reset is a no-op so concurrent delivery completion cannot invalidate the returned state. The stable TypeScript contract count rises from 42 to 43. — Thanks @imjlk!

### Patch changes

- [4296c76](https://github.com/imjlk/listmonk-ops/commit/4296c76ff1ef0ceeee9ee536f1d04bb2dbc0916c) Promote `sequences.pause` and `sequences.resume` from `experimental` to `stable`. Both operations are reversible writes, treat an already-paused or already-active sequence as a no-op without advancing `updatedAt`, retry safely across the file and PostgreSQL backends, and project the same redacted sequence definition contract that the stable sequence reads already use. The stable TypeScript contract count rises from 40 to 42. — Thanks @imjlk!
- Updated dependencies: operations@0.12.0

## 0.4.2 — 2026-08-05

### Patch changes

- Updated dependencies: openapi@0.6.0, operations@0.11.0

## 0.4.1 — 2026-08-02

### Patch changes

- Updated dependencies: openapi@0.5.0, operations@0.10.0

## 0.4.0 — 2026-07-31

### Security

- [179279f](https://github.com/imjlk/listmonk-ops/commit/179279fa18268aaddbbd7ba15a816efbd1b7e0b4) Redact sensitive webhook endpoint and delivery projection values — Thanks @imjlk!
- [1cde446](https://github.com/imjlk/listmonk-ops/commit/1cde4461884bc15cd0bd78089ee3b17fa085363c) Redact sensitive sequence definition and enrollment read projections — Thanks @imjlk!
- [9636e08](https://github.com/imjlk/listmonk-ops/commit/9636e08b8389848af25649ea30c79165e7aebb08) Reject credential material in provider diagnostic output. — Thanks @imjlk!
- [3eb67ba](https://github.com/imjlk/listmonk-ops/commit/3eb67ba5d486bff97b08e52e3a1dfdccf0bf49ea) Project webhook and workflow failures as bounded redacted summaries — Thanks @imjlk!

### Patch changes

- Updated dependencies: operations@0.9.0

## 0.3.0 — 2026-07-30

### Added

- [42dd39f](https://github.com/imjlk/listmonk-ops/commit/42dd39f43d0bb1f32b4440820453c79c5b986dfe) Add durable webhook worker health, provider event ingestion, circuit breakers, and dead-letter replay. — Thanks @imjlk!
- [903606f](https://github.com/imjlk/listmonk-ops/commit/903606f44d6cb50a1b16622128c7e55d59e10c8e) Add a compiler-driven durable sequence engine with shared CLI/MCP operations, JSON/Postgres persistence, worker health, and recovery-safe delivery. — Thanks @imjlk!
- [5fe66a8](https://github.com/imjlk/listmonk-ops/commit/5fe66a88835a7ce29658bc566585a686362fd077) Add typed signed outbound event webhooks, durable outbox delivery, and shared CLI/MCP management operations. — Thanks @imjlk!
- [ca7e076](https://github.com/imjlk/listmonk-ops/commit/ca7e07630293cba676ca4962ed005583012ddee0) Complete the compiler-driven email operations specification for all public shared operations and expose inspected-state guards through CLI lifecycle commands — Thanks @imjlk!
- [df2de54](https://github.com/imjlk/listmonk-ops/commit/df2de544f7404f8f5a8e4aa59a81b2acb833e8bd) Add compiler-driven SES-first provider and deliverability diagnostics with shared CLI/MCP operations, exact duplicate-safe SMTP pool and credential-fingerprint binding, strict redacted profile configuration, DMARC tree-walk and sender-aware ordered CIDR/DKIM/SPF DNS checks with recursive bounded per-family lookup budgets, partial include authorization, bounded resolved `a`/`mx` range matching, quota inspection, and local-stack parity coverage. — Thanks @imjlk!
- [e91f5f9](https://github.com/imjlk/listmonk-ops/commit/e91f5f9e45fd2464370e50997be95aa528400513) Add a Postgres-backed durable webhook runtime, lease recovery maintenance operations, and typed domain lifecycle event projection. — Thanks @imjlk!

### Changed

- [ca7e076](https://github.com/imjlk/listmonk-ops/commit/ca7e07630293cba676ca4962ed005583012ddee0) Update the shared esbuild toolchain to the patched 0.28.1 release — Thanks @imjlk!

### Fixed

- [903606f](https://github.com/imjlk/listmonk-ops/commit/903606f44d6cb50a1b16622128c7e55d59e10c8e) Keep webhook workers healthy after transient heartbeat failures, avoid circuit trips for disabled backlog, and prune abandoned workers. — Thanks @imjlk!

### Patch changes

- Updated dependencies: common@0.5.1, openapi@0.4.2, operations@0.8.0

## 0.2.3 — 2026-07-28

### Changed

- [2117c34](https://github.com/imjlk/listmonk-ops/commit/2117c342c0415c1f75d9a323dc9c5f665f4f962b) Register automation and A/B test operations with explicit operation-spec migration coverage. — Thanks @imjlk!

### Patch changes

- Updated dependencies: operations@0.7.0

## 0.2.2 — 2026-07-28

### Patch changes

- Updated dependencies: operations@0.6.0

## 0.2.1 — 2026-07-27

### Patch changes

- Updated dependencies: common@0.5.0, openapi@0.4.1, operations@0.5.0

## 0.2.0 — 2026-07-27

### Fixed

- [769ed92](https://github.com/imjlk/listmonk-ops/commit/769ed92f319ff70243d0ba22e6cb68c077ca3c44) Add deterministic SHA-256 assignment and chunked bulk membership to A/B test provisioning so retries and reconciliation never re-split the audience, and correct the subscriber manageLists `target_list_ids` type to an array (the Listmonk v6.2.0 server rejects scalars). Migrate the on-disk store to schema version 2 with backward-compatible v1 reads. Update automation hygiene to wrap targetListId in an array for the corrected manageLists signature. — Thanks @imjlk!

### Minor changes

- [9181c28](https://github.com/imjlk/listmonk-ops/commit/9181c28cef62c23f2147bbf3ae28790321948ff9) Fix automation correctness: hygiene mode-specific validation and PII redaction (breaking: sample field email → emailMasked), digest lifetime/window metric separation with truncation reporting, guard minimum-sent gate, and segment drift baseline mode selection. — Thanks @imjlk!
- [c79e330](https://github.com/imjlk/listmonk-ops/commit/c79e330c1013b32913f864b0f12e31ff3a76e21a) Automation security hardening: SSRF defense in preflight link checking (private IP/loopback/metadata blocking, manual redirect revalidation, bounded concurrency), store path redaction from MCP/CLI operation outputs and error messages, template promote optimistic concurrency (expectedRemoteHash + force), and fractional aggregate baselines in segment drift. — Thanks @imjlk!

### Patch changes

- Updated dependencies: common@0.4.0, openapi@0.4.0, operations@0.4.0

## 0.1.7 — 2026-07-23

### Added

- [9c1e818](https://github.com/imjlk/listmonk-ops/commit/9c1e81837c354d1718da51f5ef46c515cdbc8f79) Add shared operation catalog discovery for CLI and MCP parity — Thanks @imjlk!

### Patch changes

- Updated dependencies: common@0.3.0, openapi@0.3.0, operations@0.3.0

## 0.1.6 — 2026-07-21

### Added

- [2d5f2f1](https://github.com/imjlk/listmonk-ops/commit/2d5f2f1849ee042d237ef7b31913bd48d957e080) Expose typed ops operation contracts for CLI and MCP parity — Thanks @imjlk!

### Patch changes

- Updated dependencies: operations@0.2.0

## 0.1.5 — 2026-07-21

### Fixed

- [085ed77](https://github.com/imjlk/listmonk-ops/commit/085ed77e146e8327fbe8b8d341de87ba4e05a60d) Stabilize concurrent segment snapshot test ordering on loaded CI runners — Thanks @imjlk!

## 0.1.4 — 2026-07-20

### Changed

- [8ccc103](https://github.com/imjlk/listmonk-ops/commit/8ccc10341381036a05c1eb62241a1000fb563c7b) Stabilize OpenAPI response handling and MCP tools, add regression coverage for Listmonk workflows, and document the updated automation behavior. — Thanks @imjlk!
- [d227f35](https://github.com/imjlk/listmonk-ops/commit/d227f35985afb8c95472991e579f28569c86afdc) Add schema-aware atomic JSON persistence with recoverable cross-process locks,
  migrate automation stores, and share transactional A/B state across CLI and
  MCP workflows. — Thanks @imjlk!

### Patch changes

- Updated dependencies: common@0.2.0, openapi@0.2.0

## 0.1.3 — 2026-03-14

### Changed

- [b225654](https://github.com/imjlk/listmonk-ops/commit/b225654b985bc3f5601af131dfccb53e53f2f093) Refresh workspace dependencies, add Renovate-based dependency automation, and generate Sampo changesets automatically for dependency PRs that touch releasable packages. — Thanks @imjlk!

### Patch changes

- Updated dependencies: openapi@0.1.5

## 0.1.2 — 2026-03-14

### Changed

- [3b22b2c](https://github.com/imjlk/listmonk-ops/commit/3b22b2c455c5883e182702eb0bb7355e52528c91) Mark executable packages as Bun-targeted where applicable, harden automation workflows against empty upstream responses, add atomic rollback to A/B test provisioning, and improve package metadata for library consumers. — Thanks @imjlk!

### Patch changes

- Updated dependencies: openapi@0.1.4

## 0.1.1 — 2026-03-14

### Changed

- [55b04d5](https://github.com/imjlk/listmonk-ops/commit/55b04d5489bd19c85891e698903d80c6f64b6fd3) Stabilize external package consumption and release workflow setup.
  
  - `@listmonk-ops/openapi`
    - improved runtime fetch resilience with safer retry policy
    - fixed config merge behavior for explicit `retries: 0`
    - aligned package entrypoints and exports for external Node/Bun usage
  - `@listmonk-ops/automation`
    - package rename from legacy ops scope and workspace path normalization
    - publishable package metadata and docs cleanup for external reuse — Thanks @imjlk!

### Patch changes

- Updated dependencies: openapi@0.1.3

