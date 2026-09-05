# @listmonk-ops/abtest

## 0.8.0 — 2026-09-05

### Minor changes

- [42797d5](https://github.com/imjlk/listmonk-ops/commit/42797d5a9ea1fcffc5810b0350f0cc875a893d7d) Applied the recipient-domain stratification quota matrix to the actual A/B test recipient assignment, closing the documented follow-up. A new `assignStratifiedMembers()` helper buckets the resolved audience by provider stratum (with the small-stratum merge), computes the constrained quota matrix with canonically sorted stratum keys, and realizes each group's slice by ranking members within every stratum with the same deterministic SHA-256 digest ordering the unstratified manifest uses — so group totals still come from the largest-remainder manifest, the assignment stays reproducible under the persisted seed (crash-resume adoption re-derives identical slices), and the stored `AbTest.stratification` is the exact matrix that was applied. The stratified pass runs before any list mutation; when any resolved subscriber lacks an email or the quota solver fails, provisioning warns and falls back to the unstratified manifest assignment with an undefined stratification instead of provisioning a half-stratified audience. — Thanks @imjlk!

### Patch changes

- Updated dependencies: openapi@0.8.0, operations@0.16.0

## 0.7.0 — 2026-08-25

### Minor changes

- [17fcb4f](https://github.com/imjlk/listmonk-ops/commit/17fcb4fea93bfa3541a8dd81886e8eb57c4d981d) Promote five operations from experimental to stable (96 → 101 stable contracts, 3 experimental remaining). `abtest.run` classifies conditionally: with both revision guards (`expected_status` + `expected_updated_at`) an identical retry converges — the guards are verified inside the store transaction, a moved test conflicts, and a terminal test is a documented no-op. `abtest.deploy-winner` becomes retry-safe through tag adoption: a retry adopts the single campaign tagged `winner:deployed` for the test — validating its `variant:<id>` tag against the freshly analyzed winner, rejecting ambiguous or duplicate tagged campaigns, and finishing an interrupted auto-launch before completing — instead of creating a second holdout delivery. `webhooks.dispatch` gains the tick's attempt-bound `recovery_set` contract (CLI `--recovery-set`, capped at 100 entries like the dispatch limit; recovery mode sizes the effective limit to the echoed set): an echoed retry claims exactly the originally claimed deliveries at their originally claimed attempt counts, though delivery itself honestly stays at-least-once (reconcile classification). A dispatch that fails mid-batch after issuing POSTs now surfaces its claimed positions as structured error details — the same `recovery_set` shape — through `WebhookDispatchFailureError`, so an ambiguous retry can echo exactly that set instead of claiming new due work. `ops.templates.registry-promote` promotes with conditional semantics — its `expected_remote_hash` pin conflicts on any intervening remote change (another operator's promotion included) instead of overwriting it, an already-current target is a `promoted: false` no-op that issues no write or head-revision advance, and an unpinned or forced retry keeps the honest unsafe classification — and `ops.templates.registry-rollback` accepts a `from_version_id` source pin, an `expected_head_revision` pin over a new monotonic registry-head counter (every registry-managed write advances it — a same-version re-promotion that restores drifted remote content included — so an A → X → A cycle that restores both the version id and the remote hash still conflicts), and an `expected_remote_hash` remote-drift pin — all verified inside the store lock. An already-applied rollback is a no-op only when the remote actually carries the target content; a target that drifted away while staying active is repaired by re-promoting it. Because Listmonk offers no conditional update the hash pins stay best-effort, and because a successful promote or rollback changes the remote hash and advances the head, a pinned retry of the original request conflicts even after its own success — that conflict is the documented reconciliation signal (`reconcileWith: templates.get`), which is why both pinned cases classify as reconcile rather than safe; any pin-less retry keeps the honest unsafe classification. Registry promote/rollback/history outputs now expose the `headRevision` counter for echoing. — Thanks @imjlk!
- [73786cd](https://github.com/imjlk/listmonk-ops/commit/73786cd1c31392cc133a290bfa7944d78f82d114) Promote `abtest.launch` and `abtest.stop` from experimental to stable with documented no-op repeats. Repeating a recorded launch (a scheduled or running test with `startedAt` set) returns the persisted test instead of rescheduling variant delivery, and repeating a completed stop returns the cancelled test; partial remote cleanup continues to converge because already-cancelled or deleted campaigns and lists are skipped. The stable TypeScript contract count rises from 75 to 77. — Thanks @imjlk!
- [df9ebf5](https://github.com/imjlk/listmonk-ops/commit/df9ebf5affac56b5a4a7bc360d7c798691399f39) Promote `abtest.create` from experimental to stable with testing-mode- and auto-launch-conditional retry semantics. Non-launching holdout creates are retry-safe end to end: the deterministic assignment seed is checkpointed before any segmentation list exists, campaigns and audience lists tagged `abtest:` by a prior crashed attempt are adopted instead of re-created, adopted-list membership is reconciled to the exact expected member set (stale crashed-attempt members removed with validated responses, missing members added), and malformed tags — duplicate holdout lists, multiple variant tags on one list, a list shared across variants, or campaigns tagged for two variants — fail explicitly. Auto-launching creates stay unsafe (sequential campaign scheduling can deliver before a retry) and full-split creates keep the legacy random shuffle as an explicitly unsafe branch; `idempotentHint` stays false. The stable TypeScript contract count rises from 82 to 83. — Thanks @imjlk!
- [0c1af5f](https://github.com/imjlk/listmonk-ops/commit/0c1af5f3719e9c037cf12e938d46ead10eedfa67) Make the A/B test create intent durable before remote provisioning. The executor commits the replay key, a canonical request fingerprint (normalized defaults, deterministic placeholders, versioned derivation), and the full create payload in its own store write before provisioning any campaigns or lists, so an ambiguous retry resumes the same test instead of provisioning duplicates, a completed create replays with `created: false`, and an explicit key reused with a different request conflicts explicitly. Launch and stop are blocked while an intent is still provisioning, and legacy records without an intent payload replay as completed creations. `abtest.create` stays experimental until remote resource ids are checkpointed or reconciled on resume. — Thanks @imjlk!
- [b5776c2](https://github.com/imjlk/listmonk-ops/commit/b5776c2970d29cc4e37ffe1a26be959dd9bb7c4f) Promote the purely local-store creates with documented replay semantics. `webhooks.create` and `sequences.create` replay an identically configured existing name as `created: false` (a conflicting configuration under the same name still fails explicitly). `abtest.create` accepts an optional `idempotency_key` (CLI `--idempotency-key`) that is derived from the request when omitted and resolves the replay inside one serialized write, but stays experimental until the key is durable before remote campaign provisioning. The stable TypeScript contract count rises from 77 to 79. — Thanks @imjlk!
- [51a677f](https://github.com/imjlk/listmonk-ops/commit/51a677f2e640fd9918e08da82edc8decf483c45c) Promote `abtest.tick` from experimental to stable with the same echoed-claim-set recovery contract as the other ticks, bound to the pre-tick status. The tick output echoes the claim positions of every non-terminal test it swept (`claim_steps`: test id plus pre-tick status), and an identical retry carrying that echoed set as `recovery_set` (CLI `--recovery-set`) runs a convergent recovery pass over exactly those tests: a member is re-processed only while it still sits at its echoed status — tests that advanced to a later status, completed, or vanished since the echo are skipped as already moved on, and the sweep never touches tests that became due after the original request. Every echoed member was due at the original tick (not-yet-due tests are never echoed, so a recovery cannot advance a test that became due only after the request), the claim positions are captured inside the same store transaction as the sweep, and a failed tick surfaces them as structured error details (`AbTestTickFailureError`) for exactly this recovery. Winner deployment is externally visible — an analyzing holdout test with autoDeployWinner creates and starts a Listmonk campaign before the local commit — so the recovery case classifies as reconcile with campaign verification guidance, and fresh ticks (without the echoed set) keep the honest unsafe classification. Duplicate echoed test ids are rejected up front, the echoed set is bounded to the members the sweep actually considered, and a fresh sweep's full echo is always replayable (no size cap). The stable TypeScript contract count rises from 90 to 91. — Thanks @imjlk!
- [ddfaec0](https://github.com/imjlk/listmonk-ops/commit/ddfaec0cc9a8d6cfd3c02e94414014cb86af6922) Checkpoint A/B test creation provisioning phase by phase and reconcile remote campaigns by tag. The create executor now commits after the campaign phase and after the segmentation phase, so a crash before segmentation never re-creates campaigns: campaigns carry deterministic `abtest:<testId>` and `variant:<variantId>` tags, resume reconciles them by tag (adopting exactly-one matches, failing on ambiguity), and only missing variants are created. `provisionTest` adopts committed checkpoints instead of re-provisioning, and the shared finalization path marks the record provisioned. The operation stays experimental — a crash mid-segmentation re-splits the audience with a fresh seed until the segmentation checkpoint reconciles tagged lists the same way. — Thanks @imjlk!
- [7c85f96](https://github.com/imjlk/listmonk-ops/commit/7c85f964b9872be831bc84701a2a8db50d3d7b2f) Promote the four remaining delete operations from experimental to stable by making an already-deleted resource a documented no-op: `webhooks.delete`, `sequences.delete`, and `abtest.delete` now report `deleted: false` instead of surfacing not-found errors on repeats, and `templates.delete` distinguishes Listmonk's shared "non-existent or default template" rejection so only a genuinely missing template becomes a no-op while the protected default template still fails explicitly. The webhook and sequence delete outputs make the echoed record optional when nothing was deleted. The stable TypeScript contract count rises from 71 to 75. — Thanks @imjlk!
- [ce47668](https://github.com/imjlk/listmonk-ops/commit/ce47668fae41670d09518cdf87d1ae2f9c3e133e) Promote the three reconcile operations from experimental to stable with an echoed-scanned-set recovery contract. `sequences.reconcile`, `webhooks.reconcile`, and `abtest.reconcile` each echo the exact record ids their scan considered (`scanned_ids`), and an identical retry carrying that echo as `recovery_set` re-examines exactly that batch: leases already recovered by the original call are no longer expired and are skipped, drift already repaired no longer matches its repair condition, and the retry never selects the next backlog batch — so it converges over the echoed set. The sequences ambiguous-send resolution mode is independently convergent (it requires the enrollment to still be in the ambiguous status, so a retry after a completed resolution is rejected rather than re-applied). File and PostgreSQL sequence stores gain an enrollmentIds bound on the expired-lease scan; the webhook reconcile gains a deliveryIds bound in both stores; the A/B reconcile filters its examination to the echoed test ids and rejects duplicate echoed ids. Fresh scans (without the echoed set) keep the honest reconcile/unsafe classifications because a bounded scan selects the next backlog batch after an ambiguous result. The stable TypeScript contract count rises from 91 to 94. — Thanks @imjlk!

### Patch changes

- [12574f7](https://github.com/imjlk/listmonk-ops/commit/12574f7c970c6f7dc22f9753fa8aa29f7e34cb2e) Harden two persistence boundaries left open by review on the recent stabilization batches. Segment drift sample keys are now rejected before writing when they exceed the published 200-trimmed-character contract, and persisted overlength keys are rejected when the store is read. The A/B test store validates `provisionedAt` as a real timestamp instead of any string. — Thanks @imjlk!
- Updated dependencies: common@0.6.0, openapi@0.7.1, operations@0.15.0

## 0.6.1 — 2026-08-13

### Patch changes

- Updated dependencies: openapi@0.7.0, operations@0.14.0

## 0.6.0 — 2026-08-08

### Fixed

- [0015e8e](https://github.com/imjlk/listmonk-ops/commit/0015e8e824e91fda98a5f05d6443880e4bc717bf) Align A/B runtime validation, TypeScript contracts, and published JSON Schemas, and expose a typed assignment manifest. — Thanks @imjlk!
- [2bf948b](https://github.com/imjlk/listmonk-ops/commit/2bf948baacc63e81fd83ff83e30b6e0a0deb431f) Align A/B lifecycle effects, retry semantics, descriptions, and MCP idempotency metadata with the campaign scheduling and cleanup runtime. — Thanks @imjlk!

### Minor changes

- [c12abb0](https://github.com/imjlk/listmonk-ops/commit/c12abb00c54378c5fb5a7f4930708cc63db91cfc) Migrate all 12 remaining A/B test operations from runtime-operation bridge snapshots to standalone TypeScript/Typia product contracts. The experimental runtime bridge count drops from 13 to 0, completing the full bridge-to-standalone migration. All 104 shared operations now use standalone TypeScript contracts authored with Typia. — Thanks @imjlk!

### Patch changes

- [c8a2ae2](https://github.com/imjlk/listmonk-ops/commit/c8a2ae2d5c3bd1e96b4b984ee6dfc97f60d0bb3c) Address unaddressed P1 Codex findings: add delivery effect to abtest.launch, delete effects to abtest.stop, reject zero-duration creates. Fix stale bridge documentation. — Thanks @imjlk!
- Updated dependencies: operations@0.13.0

## 0.5.4 — 2026-08-06

### Patch changes

- Updated dependencies: operations@0.12.0

## 0.5.3 — 2026-08-05

### Patch changes

- Updated dependencies: openapi@0.6.0, operations@0.11.0

## 0.5.2 — 2026-08-02

### Patch changes

- Updated dependencies: openapi@0.5.0, operations@0.10.0

## 0.5.1 — 2026-07-31

### Patch changes

- Updated dependencies: operations@0.9.0

## 0.5.0 — 2026-07-30

### Changed

- [ca7e076](https://github.com/imjlk/listmonk-ops/commit/ca7e07630293cba676ca4962ed005583012ddee0) Update the shared esbuild toolchain to the patched 0.28.1 release — Thanks @imjlk!

### Added

- [ca7e076](https://github.com/imjlk/listmonk-ops/commit/ca7e07630293cba676ca4962ed005583012ddee0) Complete the compiler-driven email operations specification for all public shared operations and expose inspected-state guards through CLI lifecycle commands — Thanks @imjlk!

### Patch changes

- Updated dependencies: common@0.5.1, openapi@0.4.2, operations@0.8.0

## 0.4.3 — 2026-07-28

### Changed

- [2117c34](https://github.com/imjlk/listmonk-ops/commit/2117c342c0415c1f75d9a323dc9c5f665f4f962b) Register automation and A/B test operations with explicit operation-spec migration coverage. — Thanks @imjlk!

### Patch changes

- Updated dependencies: operations@0.7.0

## 0.4.2 — 2026-07-28

### Patch changes

- Updated dependencies: operations@0.6.0

## 0.4.1 — 2026-07-27

### Patch changes

- Updated dependencies: common@0.5.0, openapi@0.4.1, operations@0.5.0

## 0.4.0 — 2026-07-27

### Added

- [eecc554](https://github.com/imjlk/listmonk-ops/commit/eecc55448e225876999e1ba1521c3ccba53cbf1f) Drive A/B test decisions from the pre-registered primary metric and direction. Reports include hypothesis metadata, pre-registration verification status (verified/not_available/checksum_mismatch), and checksum mismatch warnings. The analysis path honors minimize direction for hypothesis-driven winner selection. — Thanks @imjlk!
- [30916ca](https://github.com/imjlk/listmonk-ops/commit/30916ca7cea1add68dfa7b2fed362c741f8c18d2) Add hypothesis metadata for A/B test pre-registration: structured objective, primary metric, expected lift, owner, and experiment scope with canonical checksum locking. AbTest gains optional hypothesis and assignmentProvenance fields. — Thanks @imjlk!
- [2c30522](https://github.com/imjlk/listmonk-ops/commit/2c30522e92ea4e9d1895c253b40fc25c341d818d) Add Holm-Bonferroni multiple-comparison correction, fixed-horizon eligibility gate, and Sample Ratio Mismatch (SRM) detection for A/B/C test analysis. StatisticalAnalysis output now includes correctedPValue, holmCorrected, srmPassed, and fixedHorizonReasonCodes fields. — Thanks @imjlk!
- [4b79da7](https://github.com/imjlk/listmonk-ops/commit/4b79da765f926bb039fccecbb18b3e0102bfbc94) Add preview and seed send gate: content checksum for post-approval change detection, preview check recording with render/unsubscribe/placeholder validation, seed recipient policy with domain allowlist and dedup, seed send run lifecycle with ambiguous-timeout handling, and approve/reject gate operations. Content changes invalidate prior approvals; raw recipient emails are never persisted. — Thanks @imjlk!
- [db9a23c](https://github.com/imjlk/listmonk-ops/commit/db9a23cb9015fce0f00d7995f55c19568d6fa7f9) Add orchestration lifecycle (scheduled launches, tick-based progression, reconcile), new lifecycle statuses, and shared send_at scheduling so all variant campaigns fire simultaneously. CLI gains `abtest run`, `abtest tick --dry-run`, and `abtest reconcile` commands. — Thanks @imjlk!
- [30916ca](https://github.com/imjlk/listmonk-ops/commit/30916ca7cea1add68dfa7b2fed362c741f8c18d2) Add recipient-domain stratification for A/B test assignment: classify subscribers into provider strata and compute a constrained quota matrix where row sums match stratum sizes and column sums match exact variant/holdout counts. Includes the DEFAULT_STRATIFICATION_POLICY, normalizeDomain, classifyStratum, and a paired-swap computeStratifiedQuotas solver. — Thanks @imjlk!
- [f041da1](https://github.com/imjlk/listmonk-ops/commit/f041da1db58263845f938712e87030cba048b22e) Add ConversionEventStore for conversion/revenue attribution, Experiment report generator (Markdown/JSON), and weighted sample-size validation that respects per-variant percentages. — Thanks @imjlk!
- [769ed92](https://github.com/imjlk/listmonk-ops/commit/769ed92f319ff70243d0ba22e6cb68c077ca3c44) Add deterministic SHA-256 assignment and chunked bulk membership to A/B test provisioning so retries and reconciliation never re-split the audience, and correct the subscriber manageLists `target_list_ids` type to an array (the Listmonk v6.2.0 server rejects scalars). Migrate the on-disk store to schema version 2 with backward-compatible v1 reads. Update automation hygiene to wrap targetListId in an array for the corrected manageLists signature. — Thanks @imjlk!
- [3270b3e](https://github.com/imjlk/listmonk-ops/commit/3270b3ed99abaff105ff79e7ee504089375f167c) Add experiment collision guard: installation-scoped HMAC subject keys, active-window overlap detection, and an atomic check-and-reserve participation store with block/exclude/warn policies. Prevents overlapping experiments in the same family from exposing the same subscribers without leaking PII in conflict errors. — Thanks @imjlk!
- [39930bf](https://github.com/imjlk/listmonk-ops/commit/39930bf29ac3f563b229eada16f192772424ad17) Add pluggable AbTestStoreAdapter interface with InMemoryAbTestStore and JsonFileAbTestStore implementations, plus revision bumping for optimistic concurrency control. This enables swapping persistence backends (JSON file, Postgres) without changing domain code. — Thanks @imjlk!

### Fixed

- [9fa34f7](https://github.com/imjlk/listmonk-ops/commit/9fa34f7c9e4c4d6b441e60a92c0607a87677a3c3) Fix top-two Holm family duplicate when control is a top performer, and expose minimumTestSampleSize in the operation output schema. — Thanks @imjlk!
- [5cc0780](https://github.com/imjlk/listmonk-ops/commit/5cc0780801c728528e5ddb2542112aaed9e8937f) Fix PR-44 review findings: idempotency check before validation, PII field sanitization on store, mixed-currency rejection in aggregate, attribution window NaN guard, and report winnerVariantId population from test. — Thanks @imjlk!
- [352ffa1](https://github.com/imjlk/listmonk-ops/commit/352ffa10f582fa72f97c42a5f69d66d9359437d2) Fix PR-3 followup issues: deleteTest now uses status-aware rollback for scheduled/running campaigns, reconcile --repair requires explicit scope, running tests without endsAt no longer auto-advance to analyzing, and README docs are updated with the new lifecycle commands and MCP tools. — Thanks @imjlk!
- [6c97283](https://github.com/imjlk/listmonk-ops/commit/6c972835651e058de589a89d51f43174eabd4964) Harden A/B test correctness: exact largest-remainder allocation, paginated UUID-deduped audience resolution, fail-closed metrics collection, status-aware cancel/cleanup planning, and confidence-threshold-driven statistics. Document the Listmonk v6.2.0 API behavior (bulk membership requires target_list_ids as an array, scheduled/draft campaigns cannot be cancelled only deleted, campaign tag filter uses the singular param) that informed these fixes. — Thanks @imjlk!

### Patch changes

- [68a038c](https://github.com/imjlk/listmonk-ops/commit/68a038c00e3abca51110f44ba4f7234b04cf31bf) Fix unresolved review findings across Change Sets A-E: deep-clone locked hypotheses to prevent caller-mutation checksum invalidation, include revenue columns in reports when revenue_per_recipient is the primary metric, reject missing group keys in stratification, and remove dead duplicate validation. — Thanks @imjlk!
- Updated dependencies: common@0.4.0, openapi@0.4.0, operations@0.4.0

## 0.3.1 — 2026-07-23

### Added

- [9c1e818](https://github.com/imjlk/listmonk-ops/commit/9c1e81837c354d1718da51f5ef46c515cdbc8f79) Add shared operation catalog discovery for CLI and MCP parity — Thanks @imjlk!

### Changed

- [06c1bd0](https://github.com/imjlk/listmonk-ops/commit/06c1bd090f0ad8f5b5e651408491077730da8cd2) Add graph-enforced direct regression coverage for A/B test CLI input and every shared operation invoker. — Thanks @imjlk!

### Patch changes

- Updated dependencies: common@0.3.0, openapi@0.3.0, operations@0.3.0

## 0.3.0 — 2026-07-21

### Added

- [cf17240](https://github.com/imjlk/listmonk-ops/commit/cf17240e4509c548a82cdf7ee816cdc5954d5352) Expose shared A/B test lifecycle operations across CLI and MCP — Thanks @imjlk!

### Patch changes

- Updated dependencies: operations@0.2.0

## 0.2.0 — 2026-07-20

### Added

- [d227f35](https://github.com/imjlk/listmonk-ops/commit/d227f35985afb8c95472991e579f28569c86afdc) Add schema-aware atomic JSON persistence with recoverable cross-process locks,
  migrate automation stores, and share transactional A/B state across CLI and
  MCP workflows. — Thanks @imjlk!

### Patch changes

- Updated dependencies: common@0.2.0, openapi@0.2.0

## 0.1.3 — 2026-03-14

### Changed

- [b225654](https://github.com/imjlk/listmonk-ops/commit/b225654b985bc3f5601af131dfccb53e53f2f093) Refresh workspace dependencies, add Renovate-based dependency automation, and generate Sampo changesets automatically for dependency PRs that touch releasable packages. — Thanks @imjlk!

### Patch changes

- Updated dependencies: common@0.1.3, openapi@0.1.5

## 0.1.2 — 2026-03-14

### Changed

- [3b22b2c](https://github.com/imjlk/listmonk-ops/commit/3b22b2c455c5883e182702eb0bb7355e52528c91) Mark executable packages as Bun-targeted where applicable, harden automation workflows against empty upstream responses, add atomic rollback to A/B test provisioning, and improve package metadata for library consumers. — Thanks @imjlk!

### Patch changes

- Updated dependencies: common@0.1.2, openapi@0.1.4

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

- Updated dependencies: common@0.1.1, openapi@0.1.3

