# @listmonk-ops/mcp

## 0.13.0 — 2026-08-25

### Minor changes

- [29a4cb4](https://github.com/imjlk/listmonk-ops/commit/29a4cb4f38ed78ea40309a8cfa52631f207dc4d9) Promote `sequences.enroll` from experimental to stable (102 → 103 stable contracts, 1 experimental remaining). The enroll input gains an `expected_prior_enrollments` generation guard (CLI `--expected-prior-enrollments`): the caller echoes the number of enrollments — any status — that already existed for the sequence and subscriber, observed via `sequences.enrollments.list`. The repository's `createEnrollment` verifies the count inside the store transaction (file store and Postgres), so concurrent guarded retries cannot double-create. A guarded ambiguous retry then converges across the whole lifecycle: it creates only while the count still matches, replays the single landed enrollment as `created: false` even after it reached a terminal status (closing the re-entry hazard that kept the operation experimental — an unguarded repeat restarts a terminal lifecycle), and conflicts when more than one enrollment landed or the landed one carries a different context. Intentional re-enrollment stays explicit: a request without the guard still starts a fresh lifecycle after a terminal enrollment, and that case keeps the honest non-idempotent classification. — Thanks @imjlk!
- [29af473](https://github.com/imjlk/listmonk-ops/commit/29af473b254f042a7c5ec686e6d00820987b4a02) Promote `ops.subscribers.hygiene` from experimental to stable — the final experimental descriptor (103 → 104 stable contracts, 0 experimental remaining). The dry run now reports each selected subscriber's raw `updated_at` observation as a `subscriberUpdatedAt` array parallel to `subscriberIds`, and the destructive echo pairs them in order as `subscriber_guards` (CLI `--subscriber-guards`), validated to cover exactly the echoed `subscriber_ids`. Listmonk advances `updated_at` on the very mutations the workflow performs — list adds and blocklisting — so the guard is the durable per-subscriber completion signal the spec's graduation criterion asked for: a guarded destructive retry skips subscribers its own first attempt already touched and ones that changed or re-entered eligibility externally (reported as `skippedGuarded`), while untouched members of the echoed set still run. Retry semantics are conditional and honest: dry runs are trivially safe, a destructive run with the full guard set classifies as reconcile (Listmonk offers no conditional mutation, so the guard is a check-then-act read verified through subscribers.list; a partially applied subscriber recovers through a fresh dry run while already-present list membership is skipped structurally, and a missing updated_at fails the run instead of fabricating a token), and a destructive run without guards keeps the unsafe classification because a re-eligible subscriber would receive a new effect. — Thanks @imjlk!
- [17fcb4f](https://github.com/imjlk/listmonk-ops/commit/17fcb4fea93bfa3541a8dd81886e8eb57c4d981d) Promote five operations from experimental to stable (96 → 101 stable contracts, 3 experimental remaining). `abtest.run` classifies conditionally: with both revision guards (`expected_status` + `expected_updated_at`) an identical retry converges — the guards are verified inside the store transaction, a moved test conflicts, and a terminal test is a documented no-op. `abtest.deploy-winner` becomes retry-safe through tag adoption: a retry adopts the single campaign tagged `winner:deployed` for the test — validating its `variant:<id>` tag against the freshly analyzed winner, rejecting ambiguous or duplicate tagged campaigns, and finishing an interrupted auto-launch before completing — instead of creating a second holdout delivery. `webhooks.dispatch` gains the tick's attempt-bound `recovery_set` contract (CLI `--recovery-set`, capped at 100 entries like the dispatch limit; recovery mode sizes the effective limit to the echoed set): an echoed retry claims exactly the originally claimed deliveries at their originally claimed attempt counts, though delivery itself honestly stays at-least-once (reconcile classification). A dispatch that fails mid-batch after issuing POSTs now surfaces its claimed positions as structured error details — the same `recovery_set` shape — through `WebhookDispatchFailureError`, so an ambiguous retry can echo exactly that set instead of claiming new due work. `ops.templates.registry-promote` promotes with conditional semantics — its `expected_remote_hash` pin conflicts on any intervening remote change (another operator's promotion included) instead of overwriting it, an already-current target is a `promoted: false` no-op that issues no write or head-revision advance, and an unpinned or forced retry keeps the honest unsafe classification — and `ops.templates.registry-rollback` accepts a `from_version_id` source pin, an `expected_head_revision` pin over a new monotonic registry-head counter (every registry-managed write advances it — a same-version re-promotion that restores drifted remote content included — so an A → X → A cycle that restores both the version id and the remote hash still conflicts), and an `expected_remote_hash` remote-drift pin — all verified inside the store lock. An already-applied rollback is a no-op only when the remote actually carries the target content; a target that drifted away while staying active is repaired by re-promoting it. Because Listmonk offers no conditional update the hash pins stay best-effort, and because a successful promote or rollback changes the remote hash and advances the head, a pinned retry of the original request conflicts even after its own success — that conflict is the documented reconciliation signal (`reconcileWith: templates.get`), which is why both pinned cases classify as reconcile rather than safe; any pin-less retry keeps the honest unsafe classification. Registry promote/rollback/history outputs now expose the `headRevision` counter for echoing. — Thanks @imjlk!
- [8e635bd](https://github.com/imjlk/listmonk-ops/commit/8e635bd6e8340fcec165ad4356b13642c7700dad) Promote `templates.create` from experimental to stable with the store-backed idempotency key, shared through the same keyed-create executor as `lists.create` and `campaigns.create`. `templates.create` accepts an optional `idempotency_key` (CLI `--idempotency-key`) that is atomically claimed in the durable resource-create store before the create is issued and then bound to the created template id: an identical retry replays that template as `created: false` without a second POST, a concurrent same-key create waits for the in-flight one instead of issuing a second POST, and a different payload or target under the same key is rejected explicitly. Template records carry no uuid, so binding requires the id in the create response — an id-less accepted response marks the claim unknown and later same-key creates fail fast with reconciliation guidance. Unkeyed creates keep the honestly unsafe classification because Listmonk template names are not unique. The output contract gains the `created` envelope (`{template, created}`), and the CLI/MCP inject the store at their boundaries. The stable TypeScript contract count rises from 85 to 86. — Thanks @imjlk!
- [132c2d6](https://github.com/imjlk/listmonk-ops/commit/132c2d6779fa9564b9dc9ab93d242bc0cd9d9db7) Promote `webhooks.test` from experimental to stable (101 → 102 stable contracts, 2 experimental remaining). The keyed probe's event id derivation is now an HMAC over a server-generated high-entropy probe id key persisted with the webhook store — the file store's `probeIdKey` field or the Postgres `webhook_runtime_meta` table, created lazily on first use — giving key separation from every endpoint signing credential: probe identity is decoupled from the signing secret, and a low-entropy signing secret cannot be brute-forced from known probe message/id pairs. The derivation remains bound to the endpoint's configuration revision (a repeat after a URL or secret change tests the new configuration), and a keyed probe now fails fast with `signing_secret_unavailable` when the signing secret cannot be resolved or is blank — the dispatch would fail signing without it anyway — without disclosing the secret reference in the message. A keyed retry still collapses onto the queued delivery via the outbox dedup and replays or resumes it, but delivery itself stays honestly at-least-once: the keyed retry case classifies as reconcile (verified through `webhooks.delivery.list`, with the event-id header enabling receiver deduplication; a pruned original lets a repeat send a fresh probe), while unkeyed probes derive a fresh random event id per attempt and keep the unsafe classification. Upgrades are bridged: a keyed retry whose probe was queued by the previous (pre-HMAC) release first resolves the legacy unsalted derived id for the same endpoint, correlation id, and configuration revision and converges onto that delivery, so the migration cannot queue a second probe that also POSTs. The unsalted `testEventUuid` helper is retained as deprecated; the operation derives with the new `keyedTestEventUuid`. — Thanks @imjlk!
- [0c1af5f](https://github.com/imjlk/listmonk-ops/commit/0c1af5f3719e9c037cf12e938d46ead10eedfa67) Make the A/B test create intent durable before remote provisioning. The executor commits the replay key, a canonical request fingerprint (normalized defaults, deterministic placeholders, versioned derivation), and the full create payload in its own store write before provisioning any campaigns or lists, so an ambiguous retry resumes the same test instead of provisioning duplicates, a completed create replays with `created: false`, and an explicit key reused with a different request conflicts explicitly. Launch and stop are blocked while an intent is still provisioning, and legacy records without an intent payload replay as completed creations. `abtest.create` stays experimental until remote resource ids are checkpointed or reconciled on resume. — Thanks @imjlk!
- [4f03e2d](https://github.com/imjlk/listmonk-ops/commit/4f03e2d84b29a89e3f27638b496bb04b50e5a5dc) Promote `subscribers.create` from experimental to stable with documented email-conflict replay, verified against the local Listmonk 6.2 stack (duplicate email returns 409 while duplicate list and template names both create new records). A retry after an ambiguous create now replays the persisted subscriber as `created: false` when it matches every observable create effect (email, name, status, sorted list memberships, canonical attributes — resolved with server-side email filtering); a conflicting configuration under the same email stays an explicit error. The MCP tool output gains the `created` envelope, and the CLI distinguishes an existing subscriber from a fresh create. Also hardens the segment drift store read to reject whitespace-only persisted sample keys. The stable TypeScript contract count rises from 79 to 80. — Thanks @imjlk!
- [bffee19](https://github.com/imjlk/listmonk-ops/commit/bffee19a8b657d5f953a38c30bac39c5f22a7f5e) Promote `campaigns.clone` from experimental to stable with the store-backed idempotency key, shared through the same keyed-create executor as the other keyed creates. `campaigns.clone` accepts an optional `idempotency_key` (CLI `--idempotency-key`) that is atomically claimed in the durable resource-create store before the clone create is issued and then bound to the cloned campaign id: an identical retry (same key, same source campaign and clone name, same Listmonk target) replays that campaign with `created: false` without a second POST, a concurrent same-key clone waits for the in-flight one, and a different request or target under the same key is rejected explicitly. Keyed clones bind through the created record's id or its immutable uuid — the unkeyed path's name-snapshot fallback is deliberately not used, because it cannot prove ownership; an uncorrelatable accepted response marks the claim unknown and later same-key clones fail fast with reconciliation guidance. Unkeyed clones keep the honestly unsafe classification. The output contract gains the `created` envelope (`{campaign, created}`), and the CLI injects the file-backed store at its boundary (the MCP campaigns handler already does). The stable TypeScript contract count rises from 87 to 88. — Thanks @imjlk!
- [052f956](https://github.com/imjlk/listmonk-ops/commit/052f9566660f7b74e224d2afe02c4e05b899f8ee) Promote `webhooks.tick` from experimental to stable with the same echoed-claim-set recovery contract as `sequences.tick`, bound to the originally claimed attempt count. Webhook delivery stays honestly at least once in every mode: the echoed set bounds a retry to the originally claimed records (never new due work), but the POST itself can still duplicate an accepted-but-unobserved attempt, so both retry cases classify as reconcile with the stable event-id header available for cooperative receiver deduplication. The tick's dispatch output echoes the exact claimed deliveries with their attempt counts at claim (`claim_steps`), and an identical retry carrying that echoed set as `recovery_set` (CLI `--recovery-set`) runs a convergent recovery pass over exactly those positions: an entry is re-claimed only while its current attempt count still matches the echo — a delivery anyone has attempted since, already succeeded or exhausted, holding a live lease, sitting in backoff, or facing an open circuit is skipped, with the retryable ones reported as `pending_ids` — so the retry never claims new due work and never delivers past the originally claimed position. The reconcile phase of the tick remains idempotent lease maintenance. File and PostgreSQL webhook stores gain attempt-count binding on targeted claims, and fresh ticks (without the echoed set) keep the honest at-least-once reconcile classification. The stable TypeScript contract count rises from 89 to 90. — Thanks @imjlk!
- [51a677f](https://github.com/imjlk/listmonk-ops/commit/51a677f2e640fd9918e08da82edc8decf483c45c) Promote `abtest.tick` from experimental to stable with the same echoed-claim-set recovery contract as the other ticks, bound to the pre-tick status. The tick output echoes the claim positions of every non-terminal test it swept (`claim_steps`: test id plus pre-tick status), and an identical retry carrying that echoed set as `recovery_set` (CLI `--recovery-set`) runs a convergent recovery pass over exactly those tests: a member is re-processed only while it still sits at its echoed status — tests that advanced to a later status, completed, or vanished since the echo are skipped as already moved on, and the sweep never touches tests that became due after the original request. Every echoed member was due at the original tick (not-yet-due tests are never echoed, so a recovery cannot advance a test that became due only after the request), the claim positions are captured inside the same store transaction as the sweep, and a failed tick surfaces them as structured error details (`AbTestTickFailureError`) for exactly this recovery. Winner deployment is externally visible — an analyzing holdout test with autoDeployWinner creates and starts a Listmonk campaign before the local commit — so the recovery case classifies as reconcile with campaign verification guidance, and fresh ticks (without the echoed set) keep the honest unsafe classification. Duplicate echoed test ids are rejected up front, the echoed set is bounded to the members the sweep actually considered, and a fresh sweep's full echo is always replayable (no size cap). The stable TypeScript contract count rises from 90 to 91. — Thanks @imjlk!
- [e00a24a](https://github.com/imjlk/listmonk-ops/commit/e00a24a58bd341227d6a48738c80579bb8500c65) Promote `lists.create` from experimental to stable with a store-backed idempotency key. A new file-backed resource-create idempotency store in `@listmonk-ops/common` (schema-versioned, atomic writes, configured with `LISTMONK_OPS_RESOURCE_CREATE_STORE` and a `LISTMONK_OPS_RESOURCE_CREATE_STORE_MAX_RECORDS` soft cap, namespaced by the resolved Listmonk target) atomically claims `idempotency_key` (CLI `--idempotency-key`) before the create is issued and then binds it to the created list id: an identical retry replays that list as `created: false` without a second POST, a concurrent same-key create waits for the in-flight one instead of issuing a second POST, and a different payload or target under the same key is rejected explicitly. A live same-host claim (verified past PID reuse) is never stolen by age; an attempt that ends ambiguously — or whose accepted response carries neither an id nor an immutable uuid to correlate — marks its claim unknown, and later same-key creates fail fast with reconciliation guidance: the key is intentionally not reused, because no name-based check can prove which same-named list a create produced. Keyed creates require the injected store, so surfaces without one reject the key instead of silently dropping the guarantee. Unkeyed creates keep the honestly unsafe classification because Listmonk list names are not unique. The output contract gains the `created` envelope, and the CLI/MCP inject the store at their boundaries. The stable TypeScript contract count rises from 83 to 84. — Thanks @imjlk!
- [1bd0c76](https://github.com/imjlk/listmonk-ops/commit/1bd0c76d2df7c8b7ee8988cbb4b3fa4841ba9a93) Promote `media.upload` from experimental to stable with the store-backed idempotency key, shared through the same keyed-create executor as `lists.create`, `campaigns.create`, and `templates.create`. `media.upload` accepts an optional `idempotency_key` (CLI `--idempotency-key`) that is atomically claimed in the durable resource-create store before the upload is issued and then bound to the uploaded media id: an identical retry replays that media file as `created: false` without a second POST, a concurrent same-key upload waits for the in-flight one, and a different request or target under the same key is rejected explicitly. The payload hash covers the filename, the effective MIME type, and the base64 content in its normalized standard form, so equivalent encodings (data-URL prefixes, whitespace wrapping, URL-safe alphabet, missing padding) replay instead of conflicting. An attempt that ends ambiguously — or whose accepted response carries neither an id nor an immutable uuid to correlate — marks its claim unknown and later same-key uploads fail fast with reconciliation guidance. Unkeyed uploads keep the honestly unsafe classification because Listmonk media filenames are not unique. The output contract gains the `created` envelope (`{media, created}`), and the CLI/MCP inject the store at their boundaries. The stable TypeScript contract count rises from 86 to 87. — Thanks @imjlk!
- [3aaa9ae](https://github.com/imjlk/listmonk-ops/commit/3aaa9ae630109b108118b91cf22746f78f344c44) Promote `campaigns.create` from experimental to stable with the store-backed idempotency key introduced for `lists.create`, now shared through a generic keyed-create executor in `@listmonk-ops/operations`. `campaigns.create` accepts an optional `idempotency_key` (CLI `--idempotency-key`) that is atomically claimed in the durable resource-create store before the create is issued and then bound to the created campaign id: an identical retry replays that campaign as `created: false` without a second POST, a concurrent same-key create waits for the in-flight one instead of issuing a second POST, and a different payload or target under the same key is rejected explicitly. An attempt that ends ambiguously — or whose accepted response carries neither an id nor an immutable uuid to correlate — marks its claim unknown, and later same-key creates fail fast with reconciliation guidance. Unkeyed creates keep the honestly unsafe classification because Listmonk campaign names are not unique. The output contract gains the `created` envelope (`{campaign, created}`), and the CLI/MCP inject the store at their boundaries. The stable TypeScript contract count rises from 84 to 85. — Thanks @imjlk!
- [4e4e24f](https://github.com/imjlk/listmonk-ops/commit/4e4e24f9c1783c2a7b658be6084290b7ae72459c) Promote `webhooks.delivery.retry` and `webhooks.dlq.replay` from experimental to stable with generation-bound retries. `webhooks.delivery.retry` accepts an optional `expected_manual_retry_count` (CLI `--expected-manual-retry-count`) — the delivery's pre-request generation echoed from a prior retry's retry_generation output (not the post-retry manual_retry_count, which is already incremented) — and a repeat bound to it only fires while the delivery still sits at that generation: a generation-bound repeat while the original retry's pending state holds (pending count = echo + 1) is rejected with a conflict (the echo was consumed by the still-in-flight effect), an unechoed repeat while pending reports `retried: false`, and a delivery a dispatcher already completed and returned to retry moved to a later generation and is reported unmodified instead of starting another delivery cycle. `webhooks.dlq.replay` echoes each candidate dead letter's generation (`replayed_generations`) and accepts it back as `recovery_generations` (CLI `--recovery-generations`): a record is replayed only while it is still exhausted at its echoed manual retry count, so a record a worker re-exhausted after the replay — the re-entry hazard that kept the replay experimental — is skipped rather than replayed again. Both stores implement the generation filters (in-transaction in PostgreSQL). Unechoed retries keep the honest reconcile classifications. The stable TypeScript contract count rises from 94 to 96. — Thanks @imjlk!
- [ce47668](https://github.com/imjlk/listmonk-ops/commit/ce47668fae41670d09518cdf87d1ae2f9c3e133e) Promote the three reconcile operations from experimental to stable with an echoed-scanned-set recovery contract. `sequences.reconcile`, `webhooks.reconcile`, and `abtest.reconcile` each echo the exact record ids their scan considered (`scanned_ids`), and an identical retry carrying that echo as `recovery_set` re-examines exactly that batch: leases already recovered by the original call are no longer expired and are skipped, drift already repaired no longer matches its repair condition, and the retry never selects the next backlog batch — so it converges over the echoed set. The sequences ambiguous-send resolution mode is independently convergent (it requires the enrollment to still be in the ambiguous status, so a retry after a completed resolution is rejected rather than re-applied). File and PostgreSQL sequence stores gain an enrollmentIds bound on the expired-lease scan; the webhook reconcile gains a deliveryIds bound in both stores; the A/B reconcile filters its examination to the echoed test ids and rejects duplicate echoed ids. Fresh scans (without the echoed set) keep the honest reconcile/unsafe classifications because a bounded scan selects the next backlog batch after an ambiguous result. The stable TypeScript contract count rises from 91 to 94. — Thanks @imjlk!
- [85c6cd7](https://github.com/imjlk/listmonk-ops/commit/85c6cd72ba578dcf40ab59d037694db75df8bc6d) Promote `sequences.tick` from experimental to stable with a step-bound echoed-claim-set recovery contract. The tick output echoes the exact claimed enrollments with their originally claimed steps (`claimed_steps`), and an identical retry carrying that echoed set as `recovery_set` runs a convergent recovery pass over exactly those positions: an entry is re-claimed only while it still sits at its originally claimed step, while members that already advanced to a later step, completed, turned ambiguous, or hold a live lease are skipped — so the retry never claims new due work, ambiguous members stay untouched until an operator reconciles them, and repeated retries converge (transactional idempotency still prevents duplicate sends for re-executed steps). File and PostgreSQL sequence stores gain a `claimSpecific` repository operation (deterministic lock order in PostgreSQL), the CLI tick command accepts a JSON `--recovery-set`, a failed tick surfaces its claim set on the error (`SequenceTickFailureError`) for exactly this recovery, and persisted legacy worker summaries parse with an empty claim set. Skipped members still at their claimed step under a live lease are reported as pending_ids (retryable after lease expiry) instead of being folded into already_done, a failed tick surfaces its claim set as structured error details on the operation error (serialized by the MCP error boundary), and fresh ticks (without the echoed set) keep the honest reconcile classification because they claim whatever is due at request time. The stable TypeScript contract count rises from 88 to 89. — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.7.0, automation@0.8.0, common@0.6.0, openapi@0.7.1, operations@0.15.0

## 0.12.0 — 2026-08-13

### Added

- [7f8d7bd](https://github.com/imjlk/listmonk-ops/commit/7f8d7bd1190e34639c5a26b1a6a18cb55b47428f) Complete transactional messenger, subject, content-type, and multipart plain-text option parity across the Workers runtime, shared operations, CLI, MCP, and sequence automation. — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.6.1, automation@0.7.0, openapi@0.7.0, operations@0.14.0

## 0.11.1 — 2026-08-08

### Patch changes

- Updated dependencies: abtest@0.6.0, automation@0.6.0, operations@0.13.0

## 0.11.0 — 2026-08-06

### Added

- [a3a91be](https://github.com/imjlk/listmonk-ops/commit/a3a91bebe01fc2ce05d3a29cbe3a4d050577ebfd) Expose versioned least-privilege user-role manifest reconciliation through the shared CLI and MCP operation boundary with a standalone TypeScript/Typia contract, bounded dry-run planning, explicit confirmation, body-free partial-apply projection, and CLI/MCP parity coverage. — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.5.4, automation@0.5.0, operations@0.12.0

## 0.10.0 — 2026-08-05

### Added

- [8a85420](https://github.com/imjlk/listmonk-ops/commit/8a854206e7b49bb952845561d6b2f678bb3d6d88) Expose versioned template manifest reconciliation through the shared CLI and MCP operation boundary with bounded dry-run planning, explicit confirmation, and parity coverage. — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.5.3, automation@0.4.2, openapi@0.6.0, operations@0.11.0

## 0.9.1 — 2026-08-02

### Patch changes

- Updated dependencies: abtest@0.5.2, automation@0.4.1, openapi@0.5.0, operations@0.10.0

## 0.9.0 — 2026-07-31

### Security

- [1cde446](https://github.com/imjlk/listmonk-ops/commit/1cde4461884bc15cd0bd78089ee3b17fa085363c) Redact sensitive sequence definition and enrollment fields from MCP structured output — Thanks @imjlk!
- [179279f](https://github.com/imjlk/listmonk-ops/commit/179279fa18268aaddbbd7ba15a816efbd1b7e0b4) Redact sensitive webhook endpoint and delivery fields from MCP structured output — Thanks @imjlk!
- [3eb67ba](https://github.com/imjlk/listmonk-ops/commit/3eb67ba5d486bff97b08e52e3a1dfdccf0bf49ea) Return bounded mutation failure codes without raw provider or store errors — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.5.1, automation@0.4.0, operations@0.9.0

## 0.8.0 — 2026-07-30

### Changed

- [ca7e076](https://github.com/imjlk/listmonk-ops/commit/ca7e07630293cba676ca4962ed005583012ddee0) Expose complete shared operation specification coverage through MCP discovery — Thanks @imjlk!

### Added

- [42dd39f](https://github.com/imjlk/listmonk-ops/commit/42dd39f43d0bb1f32b4440820453c79c5b986dfe) Add durable webhook worker health, provider event ingestion, circuit breakers, and dead-letter replay. — Thanks @imjlk!
- [903606f](https://github.com/imjlk/listmonk-ops/commit/903606f44d6cb50a1b16622128c7e55d59e10c8e) Add a compiler-driven durable sequence engine with shared CLI/MCP operations, JSON/Postgres persistence, worker health, and recovery-safe delivery. — Thanks @imjlk!
- [5fe66a8](https://github.com/imjlk/listmonk-ops/commit/5fe66a88835a7ce29658bc566585a686362fd077) Add typed signed outbound event webhooks, durable outbox delivery, and shared CLI/MCP management operations. — Thanks @imjlk!
- [336cde1](https://github.com/imjlk/listmonk-ops/commit/336cde13dad3cfb647467a75f5e1775702fd7f55) Add typed agent discovery and readiness operations across the shared runtime, CLI, and MCP. — Thanks @imjlk!
- [df2de54](https://github.com/imjlk/listmonk-ops/commit/df2de544f7404f8f5a8e4aa59a81b2acb833e8bd) Add compiler-driven SES-first provider and deliverability diagnostics with shared CLI/MCP operations, exact duplicate-safe SMTP pool and credential-fingerprint binding, strict redacted profile configuration, DMARC tree-walk and sender-aware ordered CIDR/DKIM/SPF DNS checks with recursive bounded per-family lookup budgets, partial include authorization, bounded resolved `a`/`mx` range matching, quota inspection, and local-stack parity coverage. — Thanks @imjlk!
- [e91f5f9](https://github.com/imjlk/listmonk-ops/commit/e91f5f9e45fd2464370e50997be95aa528400513) Add a Postgres-backed durable webhook runtime, lease recovery maintenance operations, and typed domain lifecycle event projection. — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.5.0, automation@0.3.0, common@0.5.1, openapi@0.4.2, operations@0.8.0

## 0.7.1 — 2026-07-28

### Patch changes

- Updated dependencies: abtest@0.4.3, automation@0.2.3, operations@0.7.0

## 0.7.0 — 2026-07-28

### Added

- [5578960](https://github.com/imjlk/listmonk-ops/commit/557896096810d21701f49834a46a6c9b6dbbd6b7) Add a compiler-driven Email Operations Specification with Typia-generated normalized contracts, effect-derived safety policies, agent guidance, catalog projection, and graph-enforced pilot bindings for campaign get/schedule and subscriber blocklist. — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.4.2, automation@0.2.2, operations@0.6.0

## 0.6.0 — 2026-07-27

### Added

- [a5ed6de](https://github.com/imjlk/listmonk-ops/commit/a5ed6de7344256139d32a363f82e8a1c196e85b8) Add optional `idempotency_key` to the transactional send operation.
  
  When a key is supplied, the wrapper atomically claims an idempotency record
  before dispatch. Identical retries replay the original result instead of
  re-sending; a different payload under the same key is rejected as a conflict.
  Ambiguous transport failures (timeout, connection reset) leave an `unknown`
  record that blocks automatic retry **for the TTL window** (24 hours by
  default). After the TTL expires the record is swept and the same key can be
  claimed again, so operators must reconcile within that window or supply a
  fresh key.
  
  The send output is extended to `{ sent, status, duplicate?, idempotency_key?, expires_at? }`
  where `status` is `"accepted" | "replayed" | "failed"`. The store path defaults
  to `~/.listmonk-ops/transactional.json` and is overridable via
  `LISTMONK_OPS_TRANSACTIONAL_STORE`.
  
  `@listmonk-ops/common` now exports the file-backed idempotency store
  (`createFileBackedTransactionalIdempotencyStore`), the SHA-256 payload
  hasher (`hashTransactionalPayload`), and the target-namespace helper
  (`computeTransactionalTargetHash`) that the CLI and MCP adapters inject. — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.4.1, automation@0.2.1, common@0.5.0, openapi@0.4.1, operations@0.5.0

## 0.5.0 — 2026-07-27

### Removed

- [d6a27b3](https://github.com/imjlk/listmonk-ops/commit/d6a27b3f701db64d48116c2a01fccd37d46fe11c) Remove deprecated legacy `listmonk_update_campaign_status` MCP tool. Callers should migrate to the shared lifecycle operations: `listmonk_schedule_campaign`, `listmonk_start_campaign`, `listmonk_pause_campaign`, and `listmonk_cancel_campaign`, which provide proper safety metadata, confirmation gates, audit trails, and state-machine validation. — Thanks @imjlk!

### Added

- [05c99bc](https://github.com/imjlk/listmonk-ops/commit/05c99bca9bf9213124e60b14ab83b288962bf9a8) Add campaign lifecycle, subscriber bulk, transactional hardening, and media upload operations.
  
  Campaign lifecycle (6 new operations): schedule, start, pause, cancel, clone, stats. A new `campaign-lifecycle.ts` state machine rejects obviously invalid transitions before they reach Listmonk's status endpoint. `clone` copies body/lists/template under a new name and resets runtime fields.
  
  Subscriber bulk (4 new operations): add-to-lists, remove-from-lists, blocklist, unblocklist. The new `subscriber-bulk.ts` executor chunks subscriber IDs (default 500, fail-fast by default, optional continue-on-error) and supports dry-run and max-items cap.
  
  Transactional hardening: tighten recipient validation to exactly one of subscriber_email or subscriber_id (XOR), reject header values that smuggle CR/LF/NUL or other control characters, and block reserved transport headers.
  
  Media upload (1 new operation): upload media from base64-encoded contents with a MIME allowlist and a 10 MiB size cap. CLI `media upload --file <path>` reads via Bun.file and encodes the bytes.
  
  OpenAPI contract cleanup: extract CampaignOperations, SubscriberOperations, and MediaOperations into named interfaces mirroring TemplateOperations so the public types no longer rely on anonymous intersections. — Thanks @imjlk!

### Patch changes

- [c79e330](https://github.com/imjlk/listmonk-ops/commit/c79e330c1013b32913f864b0f12e31ff3a76e21a) Automation security hardening: SSRF defense in preflight link checking (private IP/loopback/metadata blocking, manual redirect revalidation, bounded concurrency), store path redaction from MCP/CLI operation outputs and error messages, template promote optimistic concurrency (expectedRemoteHash + force), and fractional aggregate baselines in segment drift. — Thanks @imjlk!
- Updated dependencies: abtest@0.4.0, automation@0.2.0, common@0.4.0, openapi@0.4.0, operations@0.4.0

## 0.4.0 — 2026-07-23

### Changed

- [1150985](https://github.com/imjlk/listmonk-ops/commit/115098571442844ea837e4a851869a0ca0f7eee3) Route default-template selection through shared CLI and MCP operations with a stable Listmonk acknowledgement — Thanks @imjlk!
- [6de0c57](https://github.com/imjlk/listmonk-ops/commit/6de0c578fb2ede2451f98fa0bbb4d22f3c992167) Expose shared media read and delete operations through CLI and MCP with consistent confirmation safety. — Thanks @imjlk!
- [f529994](https://github.com/imjlk/listmonk-ops/commit/f5299940f0ebfe38100d112edc970340d06753d4) Harden Streamable HTTP with Host and Origin validation, optional Bearer authentication, and safe non-loopback binding requirements. — Thanks @imjlk!
- [eb86a20](https://github.com/imjlk/listmonk-ops/commit/eb86a20e586f5431d6682c0c893039dba46a0b69) Require explicit confirmation and metadata-only auditing for destructive shared MCP operations — Thanks @imjlk!

### Added

- [71af85e](https://github.com/imjlk/listmonk-ops/commit/71af85ed805d93159c97d30c6035c36b48b3563c) Add local CLI and MCP transactional delivery parity coverage with Mailpit. — Thanks @imjlk!
- [9c1e818](https://github.com/imjlk/listmonk-ops/commit/9c1e81837c354d1718da51f5ef46c515cdbc8f79) Add shared operation catalog discovery for CLI and MCP parity — Thanks @imjlk!

### Fixed

- [85f71e0](https://github.com/imjlk/listmonk-ops/commit/85f71e083d556b6399f2eae178b148fa3e4f0d51) Keep MCP catalog schema assertions isolated so protocol validation remains deterministic across test orderings. — Thanks @imjlk!
- [e2a4483](https://github.com/imjlk/listmonk-ops/commit/e2a4483a64f3f4e95f7a6242351dd521be3a421f) Expose execution policy metadata in MCP operation catalog schema — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.3.1, automation@0.1.7, common@0.3.0, openapi@0.3.0, operations@0.3.0

## 0.3.0 — 2026-07-21

### Changed

- [9128105](https://github.com/imjlk/listmonk-ops/commit/91281057d73e9ac0fa9195ad2f7432e753194d6c) Route CLI and MCP ops workflows through shared typed operation contracts — Thanks @imjlk!

### Added

- [cf17240](https://github.com/imjlk/listmonk-ops/commit/cf17240e4509c548a82cdf7ee816cdc5954d5352) Expose shared A/B test lifecycle operations across CLI and MCP — Thanks @imjlk!
- [1281fc3](https://github.com/imjlk/listmonk-ops/commit/1281fc3bc6e23347eb6785f078f9a8df17197429) Centralize exact MCP tool registration and operation result metadata — Thanks @imjlk!
- [53aa4dc](https://github.com/imjlk/listmonk-ops/commit/53aa4dcd210bbffde7d54b0309e5e14577375f6c) Expose shared campaign, subscriber, and template CRUD parity — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.3.0, automation@0.1.6, operations@0.2.0

## 0.2.2 — 2026-07-21

### Changed

- [eb42347](https://github.com/imjlk/listmonk-ops/commit/eb423476d728d5f0fa33900551e634e0629df0c5) Share transactional delivery across CLI and MCP with graph and Mailpit verification — Thanks @imjlk!

### Patch changes

- Updated dependencies: automation@0.1.5, operations@0.1.3

## 0.2.1 — 2026-07-21

### Changed

- [db04303](https://github.com/imjlk/listmonk-ops/commit/db0430331540176626593618e05826042749ce1c) Expose graph-visible named list operation invokers, route the CLI and MCP list
  adapters through them, and preserve the existing validated operation contract. — Thanks @imjlk!

### Patch changes

- Updated dependencies: operations@0.1.2

## 0.2.0 — 2026-07-20

### Fixed

- [9a20afe](https://github.com/imjlk/listmonk-ops/commit/9a20afee64787f844871d1a5c227f3217a4cdca1) Adopt the TypeScript 7 and ttsc compiler pipeline across development and builds, and keep MCP startup detection compatible with the stricter compiler types. — Thanks @imjlk!
- [1d13791](https://github.com/imjlk/listmonk-ops/commit/1d1379148c9e6b9fe68411f40383cac1b2002962) Target Listmonk v6.2.0 with a reproducible upstream OpenAPI overlay, expose the renamed and newly documented API operations, and provision E2E credentials through Listmonk's hashed API-token flow. — Thanks @imjlk!
- [8ccc103](https://github.com/imjlk/listmonk-ops/commit/8ccc10341381036a05c1eb62241a1000fb563c7b) Stabilize OpenAPI response handling and MCP tools, add regression coverage for Listmonk workflows, and document the updated automation behavior. — Thanks @imjlk!
- [d227f35](https://github.com/imjlk/listmonk-ops/commit/d227f35985afb8c95472991e579f28569c86afdc) Add schema-aware atomic JSON persistence with recoverable cross-process locks,
  migrate automation stores, and share transactional A/B state across CLI and
  MCP workflows. — Thanks @imjlk!

### Added

- [b34d868](https://github.com/imjlk/listmonk-ops/commit/b34d8688e4a9e687ae520bb4a60607fdc844ee32) Expose the existing Listmonk tool registry through standard MCP stdio and Streamable HTTP transports while preserving the legacy REST endpoints. — Thanks @imjlk!
- [13220ca](https://github.com/imjlk/listmonk-ops/commit/13220ca1d9fc82e410ec190d04cc077c31acf8b5) Add a shared typed subscriber-list operation registry, expose validated MCP
  schemas, safety hints, and structured output, and route graph-friendly CLI list
  actions through the same executors with pagination support.
  
  Publish the operations package changes made after its bootstrap 0.1.0 release. — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.2.0, automation@0.1.4, openapi@0.2.0, operations@0.1.1

## 0.1.3 — 2026-03-14

### Changed

- [b225654](https://github.com/imjlk/listmonk-ops/commit/b225654b985bc3f5601af131dfccb53e53f2f093) Refresh workspace dependencies, add Renovate-based dependency automation, and generate Sampo changesets automatically for dependency PRs that touch releasable packages. — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.1.3, automation@0.1.3

## 0.1.2 — 2026-03-14

### Changed

- [3b22b2c](https://github.com/imjlk/listmonk-ops/commit/3b22b2c455c5883e182702eb0bb7355e52528c91) Mark executable packages as Bun-targeted where applicable, harden automation workflows against empty upstream responses, add atomic rollback to A/B test provisioning, and improve package metadata for library consumers. — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.1.2, automation@0.1.2

## 0.1.1 — 2026-03-14

### Changed

- [55b04d5](https://github.com/imjlk/listmonk-ops/commit/55b04d5489bd19c85891e698903d80c6f64b6fd3) Expand package publishability and release ergonomics across CLI/MCP-related workspaces.
  
  - `@listmonk-ops/cli`
    - publish-ready package metadata (`bin`, `files`, `prepublishOnly`, semver deps)
    - completion metadata packaging alignment for npm installs
    - GitHub release binary pipeline and curl installer support
  - `@listmonk-ops/common`
    - compiled `dist` entrypoints for external Node/Bun consumers
  - `@listmonk-ops/abtest`
    - publish-ready package metadata and semver dependency references
  - `@listmonk-ops/mcp`
    - publish-ready metadata (`bin`, `files`, semver deps)
    - runtime CLI flags for explicit Listmonk endpoint/auth config — Thanks @imjlk!

### Patch changes

- Updated dependencies: abtest@0.1.1, automation@0.1.1

