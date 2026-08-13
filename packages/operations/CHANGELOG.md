# @listmonk-ops/operations

## 0.14.0 — 2026-08-13

### Security

- [1e4644c](https://github.com/imjlk/listmonk-ops/commit/1e4644c3a57b3e08924bc2bc86b7e3a7fd5aa32f) Validate transactional From overrides as one mailbox across shared sends and sequence definitions, and align the published sender, messenger, and subject contracts with runtime parsing. — Thanks @imjlk!
- [8f99973](https://github.com/imjlk/listmonk-ops/commit/8f99973d05b0f5ec385a7b5e473cda057cb11fb7) Reject caller-controlled SMTP routing, trace, sender, and resend headers before transactional dispatch. — Thanks @imjlk!
- [d0bb75c](https://github.com/imjlk/listmonk-ops/commit/d0bb75cdb3eb55d56112f49364ac0ca9298e9e7d) Reserve SMTP authentication and routing metadata headers before transactional dispatch. — Thanks @imjlk!

### Added

- [7f8d7bd](https://github.com/imjlk/listmonk-ops/commit/7f8d7bd1190e34639c5a26b1a6a18cb55b47428f) Complete transactional messenger, subject, content-type, and multipart plain-text option parity across the Workers runtime, shared operations, CLI, MCP, and sequence automation. — Thanks @imjlk!

### Patch changes

- Updated dependencies: openapi@0.7.0

## 0.13.0 — 2026-08-08

### Fixed

- [0015e8e](https://github.com/imjlk/listmonk-ops/commit/0015e8e824e91fda98a5f05d6443880e4bc717bf) Align A/B runtime validation, TypeScript contracts, and published JSON Schemas, and expose a typed assignment manifest. — Thanks @imjlk!
- [96cd0c9](https://github.com/imjlk/listmonk-ops/commit/96cd0c99d697e0f661cef605dd81e6eb2f792b10) Restore deterministic standalone operation catalog ordering after the module split and correct the published spec documentation. — Thanks @imjlk!
- [2bf948b](https://github.com/imjlk/listmonk-ops/commit/2bf948baacc63e81fd83ff83e30b6e0a0deb431f) Align A/B lifecycle effects, retry semantics, descriptions, and MCP idempotency metadata with the campaign scheduling and cleanup runtime. — Thanks @imjlk!
- [910b58d](https://github.com/imjlk/listmonk-ops/commit/910b58d8ed67e24deeddfe58ed598cb1d0ca2889) Require confirmation for the deliverability guard's pause path, align threshold schemas, and correct subscriber hygiene retry guidance. — Thanks @imjlk!
- [e8b29da](https://github.com/imjlk/listmonk-ops/commit/e8b29da29309417d7d9b5072dd19da7ce4376822) Harden operation spec graph, schema compatibility, and retry guidance guardrails. — Thanks @imjlk!

### Minor changes

- [c12abb0](https://github.com/imjlk/listmonk-ops/commit/c12abb00c54378c5fb5a7f4930708cc63db91cfc) Migrate all 12 remaining A/B test operations from runtime-operation bridge snapshots to standalone TypeScript/Typia product contracts. The experimental runtime bridge count drops from 13 to 0, completing the full bridge-to-standalone migration. All 104 shared operations now use standalone TypeScript contracts authored with Typia. — Thanks @imjlk!
- [64aad17](https://github.com/imjlk/listmonk-ops/commit/64aad17396418af3d8c4484f59f49874be35b0ee) Migrate `campaigns.create`, `campaigns.update`, and `campaigns.delete` from runtime-operation bridge snapshots to standalone TypeScript/Typia product contracts, reducing the experimental runtime bridge count from 31 to 28. CampaignUpdateInput is modeled as an inclusive union (anyOf) requiring at least one mutable field. `campaigns.pause` and `campaigns.clone` remain bridged. — Thanks @imjlk!
- [4724554](https://github.com/imjlk/listmonk-ops/commit/4724554ce14b3abff61ec521b6e6cb7d058846e3) Migrate all six remaining ops workflow operations (deliverability-guard, subscriber-hygiene, registry-sync, registry-history, registry-promote, registry-rollback) from runtime-operation bridge snapshots to standalone TypeScript/Typia product contracts, reducing the experimental runtime bridge count from 19 to 13. The ops workflow family is now fully standalone. — Thanks @imjlk!
- [4cbc4c3](https://github.com/imjlk/listmonk-ops/commit/4cbc4c3634db726d939b029afbf0039200f5a92e) Migrate `ops.segments.drift` and `ops.digest.daily` from runtime-operation bridge snapshots to standalone TypeScript/Typia product contracts, reducing the experimental runtime bridge count from 21 to 19. — Thanks @imjlk!
- [99dcae9](https://github.com/imjlk/listmonk-ops/commit/99dcae9f2cb9a9312e6955cb6b14f3277dec7232) Migrate `subscribers.add-to-lists`, `subscribers.remove-from-lists`, and `subscribers.unblocklist` from runtime-operation bridge snapshots to standalone TypeScript/Typia product contracts, reducing the experimental runtime bridge count from 24 to 21. All three operations share the existing SubscriberBulkOutput contract; add-to-lists and remove-from-lists share SubscriberBulkListsInput, while unblocklist uses SubscriberBulkBlocklistInput. — Thanks @imjlk!
- [5b61ca2](https://github.com/imjlk/listmonk-ops/commit/5b61ca2b73bbc611e002e6b39a10e4f1d75b7f5b) Migrate `campaigns.pause` and `campaigns.clone` from runtime-operation bridge snapshots to standalone TypeScript/Typia product contracts, reducing the experimental runtime bridge count from 26 to 24. Campaigns.pause reuses the existing lifecycle contract; campaigns.clone introduces a CampaignCloneInput contract. — Thanks @imjlk!
- [d397229](https://github.com/imjlk/listmonk-ops/commit/d3972299f0137fd96241c49bb5841a96c38d9f35) Migrate `subscribers.create`, `subscribers.update`, and `subscribers.delete` from runtime-operation bridge snapshots to standalone TypeScript/Typia product contracts, reducing the experimental runtime bridge count from 34 to 31. SubscriberUpdateInput is modeled as a union requiring at least one mutable field (matching the runtime refine), and subscriber email fields use the shared EmailAddress tag. — Thanks @imjlk!
- [58143a7](https://github.com/imjlk/listmonk-ops/commit/58143a707c801f34f309e70e171cb59cb45b9787) Promote `templates.update` and `templates.set-default` from `experimental` to `stable`. Both operations are reversible writes whose retry semantics are already safe: update merges the current template with the requested fields before PUT, so reapplying the same fields converges on the same representation; set-default is idempotent since setting an already-default template is a server-side no-op. The stable TypeScript contract count rises from 44 to 46. — Thanks @imjlk!
- [a56cfd8](https://github.com/imjlk/listmonk-ops/commit/a56cfd84021b70d474fe9e0cf440f86798f637cf) Migrate `lists.create`, `lists.update`, and `lists.delete` from runtime-operation bridge snapshots to standalone TypeScript/Typia product contracts, reducing the experimental runtime bridge count from 37 to 34. The list update effect is reclassified as reversible (matching templates.update) so its destructive safety hint and confirmation policy align with the standalone contract. — Thanks @imjlk!
- [2a5edf1](https://github.com/imjlk/listmonk-ops/commit/2a5edf178c3bd97cbaa3196dbf14e65e2be356c6) Migrate `media.delete` and `media.upload` from runtime-operation bridge snapshots to standalone TypeScript/Typia product contracts, reducing the experimental runtime bridge count from 28 to 26. — Thanks @imjlk!

### Patch changes

- [c8a2ae2](https://github.com/imjlk/listmonk-ops/commit/c8a2ae2d5c3bd1e96b4b984ee6dfc97f60d0bb3c) Address unaddressed P1 Codex findings: add delivery effect to abtest.launch, delete effects to abtest.stop, reject zero-duration creates. Fix stale bridge documentation. — Thanks @imjlk!
- [fdff15b](https://github.com/imjlk/listmonk-ops/commit/fdff15b2430721fc71861486eaed89ae0831fcf8) Split src/specs/core-reads.ts into domain-specific standalone-spec modules. No contract changes — only file reorganization. — Thanks @imjlk!
- [8856302](https://github.com/imjlk/listmonk-ops/commit/8856302e6fb88de71c687de89722907a0c16316c) Split scripts/spec-contracts.ts into 14 domain-specific modules under scripts/spec-contracts/. No contract changes — only file reorganization. — Thanks @imjlk!

## 0.12.0 — 2026-08-06

### Minor changes

- [26d6689](https://github.com/imjlk/listmonk-ops/commit/26d6689c1a85dda55eae733bf46ad34d63254ab8) Correct the retry semantics on `webhooks.reconcile`: the operation was described as a safe idempotent no-op, but reconciliation is bounded by a per-call limit and an ambiguous retry can select and mutate the next batch of expired deliveries. Switch retry to `kind: "reconcile"` with `idempotent: false`, align the runtime operation's `idempotentHint`, and update the agent retry guidance to verify the remaining backlog in dry-run mode before retrying. The operation stays `experimental` pending a request-level idempotency guarantee. Both operations and automation are released together because the runtime adapter's safety hint and the spec must stay in sync at module initialization. — Thanks @imjlk!
- [3bc460b](https://github.com/imjlk/listmonk-ops/commit/3bc460ba9d77a59c40ef7a11e999bd77d13863f8) Promote the standalone `templates.reconcile` manifest operation contract to stable after its bounded input validation, typed partial-apply errors, destructive confirmation policy, and named/generic invocation paths were aligned. — Thanks @imjlk!
- [4296c76](https://github.com/imjlk/listmonk-ops/commit/4296c76ff1ef0ceeee9ee536f1d04bb2dbc0916c) Promote `sequences.pause` and `sequences.resume` from `experimental` to `stable`. Both operations are reversible writes, treat an already-paused or already-active sequence as a no-op without advancing `updatedAt`, retry safely across the file and PostgreSQL backends, and project the same redacted sequence definition contract that the stable sequence reads already use. The stable TypeScript contract count rises from 40 to 42. — Thanks @imjlk!
- [b620e60](https://github.com/imjlk/listmonk-ops/commit/b620e60f9576a3a5f66e5707c9e3bb9d1d2db212) Promote `webhooks.circuit.reset` from `experimental` to `stable`. Short-circuit both the file and Postgres repositories so resetting an already-closed circuit with zero failures is a true no-op that does not replace the runtime record, matching the spec's idempotent retry claim. Preserve file-backed success and failure history across reset results, and lock the Postgres endpoint row before deciding whether reset is a no-op so concurrent delivery completion cannot invalidate the returned state. The stable TypeScript contract count rises from 42 to 43. — Thanks @imjlk!

### Patch changes

- [8397df8](https://github.com/imjlk/listmonk-ops/commit/8397df8d30198218ad780c7198414608a0c99337) Migrate `templates.create`, `templates.update`, `templates.delete`, and `templates.set-default` from runtime bridge snapshots to standalone TypeScript/Typia product contracts while preserving their experimental maturity, runtime validation, safety policy, and retry semantics. — Thanks @imjlk!
- [844f5bf](https://github.com/imjlk/listmonk-ops/commit/844f5bf8b09946515d6d014320bbe41bee424cbc) Address Codex review follow-ups on the templates.reconcile standalone contract: drop the subject MaxLength<500> bound and document the empty-string default, and exclude transport-only controls (dry_run) from the raw manifest byte cap so the documented 1 MiB limit measures manifest content. The same byte-cap fix is applied to user-roles.reconcile for consistency. — Thanks @imjlk!
- [49fb030](https://github.com/imjlk/listmonk-ops/commit/49fb0306805e7fa8f3ae6fd8e14aeb575659ae3e) Migrate the `templates.reconcile` operation spec from a runtime-operation bridge to a standalone TypeScript/Typia product contract, reducing the runtime bridge count from 42 to 41. The manifest reconciliation contract (1 MiB/500 template bounds, dry-run default, body-free partial-apply projection, explicit confirmation) is preserved, and the apply-error projection no longer retains the raw remote cause. — Thanks @imjlk!
- [97bd6b9](https://github.com/imjlk/listmonk-ops/commit/97bd6b99d120b232fb97a8ddadcff08162d4c36d) Keep generic and named template and user-role manifest invocation paths consistent. Both paths now enforce the raw 1 MiB payload limit before remote reads and preserve body-free typed partial-apply errors. — Thanks @imjlk!

### Added

- [a3a91be](https://github.com/imjlk/listmonk-ops/commit/a3a91bebe01fc2ce05d3a29cbe3a4d050577ebfd) Expose versioned least-privilege user-role manifest reconciliation through the shared CLI and MCP operation boundary with a standalone TypeScript/Typia contract, bounded dry-run planning, explicit confirmation, body-free partial-apply projection, and CLI/MCP parity coverage. — Thanks @imjlk!

## 0.11.0 — 2026-08-05

### Added

- [8a85420](https://github.com/imjlk/listmonk-ops/commit/8a854206e7b49bb952845561d6b2f678bb3d6d88) Expose versioned template manifest reconciliation through the shared CLI and MCP operation boundary with bounded dry-run planning, explicit confirmation, and parity coverage. — Thanks @imjlk!

### Patch changes

- Updated dependencies: openapi@0.6.0

## 0.10.0 — 2026-08-02

### Added

- [a595f71](https://github.com/imjlk/listmonk-ops/commit/a595f716ba92a95de384e0aa07f6af54ffd90469) Add a typed Listmonk 6.2 user-role facade, declarative least-privilege role
  reconciliation, generic permission presets, and external-subscriber SDK smoke
  coverage. — Thanks @imjlk!
- [a595f71](https://github.com/imjlk/listmonk-ops/commit/a595f716ba92a95de384e0aa07f6af54ffd90469) Add versioned template-manifest planning and exact-name reconciliation helpers
  with explicit apply semantics and duplicate-name fail-closed validation. — Thanks @imjlk!

### Patch changes

- Updated dependencies: openapi@0.5.0

## 0.9.0 — 2026-07-31

### Changed

- [1cde446](https://github.com/imjlk/listmonk-ops/commit/1cde4461884bc15cd0bd78089ee3b17fa085363c) Stabilize redacted sequence definition and enrollment read contracts — Thanks @imjlk!
- [170a9b2](https://github.com/imjlk/listmonk-ops/commit/170a9b25abdf9f8b91b0a4a91c0eea3b9be93ef6) Stabilize static agent discovery operation contracts. — Thanks @imjlk!
- [9636e08](https://github.com/imjlk/listmonk-ops/commit/9636e08b8389848af25649ea30c79165e7aebb08) Stabilize provider and deliverability read operation contracts. — Thanks @imjlk!
- [054390e](https://github.com/imjlk/listmonk-ops/commit/054390e68463bddea5e1574d39fb126f663de5ff) Stabilize aggregate webhook and sequence control-plane read contracts. — Thanks @imjlk!
- [bdb8882](https://github.com/imjlk/listmonk-ops/commit/bdb8882e7dabbdaffa88dc441ba144ab750b102a) Promote the first ten mature read-only operation specs to stable TypeScript contracts. — Thanks @imjlk!
- [179279f](https://github.com/imjlk/listmonk-ops/commit/179279fa18268aaddbbd7ba15a816efbd1b7e0b4) Stabilize redacted webhook endpoint, delivery, and dead-letter read contracts — Thanks @imjlk!

### Security

- [3eb67ba](https://github.com/imjlk/listmonk-ops/commit/3eb67ba5d486bff97b08e52e3a1dfdccf0bf49ea) Prevent shared mutation results from exposing raw remote errors or subscriber identifiers — Thanks @imjlk!

## 0.8.0 — 2026-07-30

### Added

- [42dd39f](https://github.com/imjlk/listmonk-ops/commit/42dd39f43d0bb1f32b4440820453c79c5b986dfe) Add durable webhook worker health, provider event ingestion, circuit breakers, and dead-letter replay. — Thanks @imjlk!
- [903606f](https://github.com/imjlk/listmonk-ops/commit/903606f44d6cb50a1b16622128c7e55d59e10c8e) Add a compiler-driven durable sequence engine with shared CLI/MCP operations, JSON/Postgres persistence, worker health, and recovery-safe delivery. — Thanks @imjlk!
- [5fe66a8](https://github.com/imjlk/listmonk-ops/commit/5fe66a88835a7ce29658bc566585a686362fd077) Add typed signed outbound event webhooks, durable outbox delivery, and shared CLI/MCP management operations. — Thanks @imjlk!
- [336cde1](https://github.com/imjlk/listmonk-ops/commit/336cde13dad3cfb647467a75f5e1775702fd7f55) Add typed agent discovery and readiness operations across the shared runtime, CLI, and MCP. — Thanks @imjlk!
- [ca7e076](https://github.com/imjlk/listmonk-ops/commit/ca7e07630293cba676ca4962ed005583012ddee0) Complete the compiler-driven email operations specification for all public shared operations and expose inspected-state guards through CLI lifecycle commands — Thanks @imjlk!
- [df2de54](https://github.com/imjlk/listmonk-ops/commit/df2de544f7404f8f5a8e4aa59a81b2acb833e8bd) Add compiler-driven SES-first provider and deliverability diagnostics with shared CLI/MCP operations, exact duplicate-safe SMTP pool and credential-fingerprint binding, strict redacted profile configuration, DMARC tree-walk and sender-aware ordered CIDR/DKIM/SPF DNS checks with recursive bounded per-family lookup budgets, partial include authorization, bounded resolved `a`/`mx` range matching, quota inspection, and local-stack parity coverage. — Thanks @imjlk!
- [e91f5f9](https://github.com/imjlk/listmonk-ops/commit/e91f5f9e45fd2464370e50997be95aa528400513) Add a Postgres-backed durable webhook runtime, lease recovery maintenance operations, and typed domain lifecycle event projection. — Thanks @imjlk!

### Changed

- [ca7e076](https://github.com/imjlk/listmonk-ops/commit/ca7e07630293cba676ca4962ed005583012ddee0) Update the shared esbuild toolchain to the patched 0.28.1 release — Thanks @imjlk!

### Patch changes

- Updated dependencies: openapi@0.4.2

## 0.7.0 — 2026-07-28

### Added

- [2117c34](https://github.com/imjlk/listmonk-ops/commit/2117c342c0415c1f75d9a323dc9c5f665f4f962b) Expand operation specs with high-risk email operation descriptors, a typed safe-start playbook, and compiler-enforced migration coverage. — Thanks @imjlk!

## 0.6.0 — 2026-07-28

### Added

- [5578960](https://github.com/imjlk/listmonk-ops/commit/557896096810d21701f49834a46a6c9b6dbbd6b7) Add a compiler-driven Email Operations Specification with Typia-generated normalized contracts, effect-derived safety policies, agent guidance, catalog projection, and graph-enforced pilot bindings for campaign get/schedule and subscriber blocklist. — Thanks @imjlk!

## 0.5.0 — 2026-07-27

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

- Updated dependencies: openapi@0.4.1

## 0.4.0 — 2026-07-27

### Added

- [05c99bc](https://github.com/imjlk/listmonk-ops/commit/05c99bca9bf9213124e60b14ab83b288962bf9a8) Add campaign lifecycle, subscriber bulk, transactional hardening, and media upload operations.
  
  Campaign lifecycle (6 new operations): schedule, start, pause, cancel, clone, stats. A new `campaign-lifecycle.ts` state machine rejects obviously invalid transitions before they reach Listmonk's status endpoint. `clone` copies body/lists/template under a new name and resets runtime fields.
  
  Subscriber bulk (4 new operations): add-to-lists, remove-from-lists, blocklist, unblocklist. The new `subscriber-bulk.ts` executor chunks subscriber IDs (default 500, fail-fast by default, optional continue-on-error) and supports dry-run and max-items cap.
  
  Transactional hardening: tighten recipient validation to exactly one of subscriber_email or subscriber_id (XOR), reject header values that smuggle CR/LF/NUL or other control characters, and block reserved transport headers.
  
  Media upload (1 new operation): upload media from base64-encoded contents with a MIME allowlist and a 10 MiB size cap. CLI `media upload --file <path>` reads via Bun.file and encodes the bytes.
  
  OpenAPI contract cleanup: extract CampaignOperations, SubscriberOperations, and MediaOperations into named interfaces mirroring TemplateOperations so the public types no longer rely on anonymous intersections. — Thanks @imjlk!

### Patch changes

- Updated dependencies: openapi@0.4.0

## 0.3.0 — 2026-07-23

### Changed

- [1150985](https://github.com/imjlk/listmonk-ops/commit/115098571442844ea837e4a851869a0ca0f7eee3) Route default-template selection through shared CLI and MCP operations with a stable Listmonk acknowledgement — Thanks @imjlk!
- [6de0c57](https://github.com/imjlk/listmonk-ops/commit/6de0c578fb2ede2451f98fa0bbb4d22f3c992167) Expose shared media read and delete operations through CLI and MCP with consistent confirmation safety. — Thanks @imjlk!

### Added

- [b52b7f1](https://github.com/imjlk/listmonk-ops/commit/b52b7f1fa9e3a34c4c3c99e70eca7a2b094d38c1) Add execution policy metadata and atomic operation audit storage — Thanks @imjlk!
- [9c1e818](https://github.com/imjlk/listmonk-ops/commit/9c1e81837c354d1718da51f5ef46c515cdbc8f79) Add shared operation catalog discovery for CLI and MCP parity — Thanks @imjlk!
- [2b16ee3](https://github.com/imjlk/listmonk-ops/commit/2b16ee3f9b6406509c500048364b18354616de55) Expose effective dry-run resolution after operation input defaults — Thanks @imjlk!

### Patch changes

- Updated dependencies: openapi@0.3.0

## 0.2.0 — 2026-07-21

### Added

- [1281fc3](https://github.com/imjlk/listmonk-ops/commit/1281fc3bc6e23347eb6785f078f9a8df17197429) Preserve transactional legacy text in shared MCP metadata — Thanks @imjlk!
- [6aadc54](https://github.com/imjlk/listmonk-ops/commit/6aadc54de32b6685ed714477c699122334aeaa2e) Add shared campaign, subscriber, and template CRUD operations — Thanks @imjlk!

## 0.1.3 — 2026-07-21

### Changed

- [eb42347](https://github.com/imjlk/listmonk-ops/commit/eb423476d728d5f0fa33900551e634e0629df0c5) Share transactional delivery across CLI and MCP with graph and Mailpit verification — Thanks @imjlk!

## 0.1.2 — 2026-07-21

### Changed

- [db04303](https://github.com/imjlk/listmonk-ops/commit/db0430331540176626593618e05826042749ce1c) Expose graph-visible named list operation invokers, route the CLI and MCP list
  adapters through them, and preserve the existing validated operation contract. — Thanks @imjlk!

## 0.1.1 — 2026-07-20

### Changed

- [13220ca](https://github.com/imjlk/listmonk-ops/commit/13220ca1d9fc82e410ec190d04cc077c31acf8b5) Add a shared typed subscriber-list operation registry, expose validated MCP
  schemas, safety hints, and structured output, and route graph-friendly CLI list
  actions through the same executors with pagination support.
  
  Publish the operations package changes made after its bootstrap 0.1.0 release. — Thanks @imjlk!

### Patch changes

- Updated dependencies: openapi@0.2.0

