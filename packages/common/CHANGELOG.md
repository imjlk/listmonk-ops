# @listmonk-ops/common

## 0.7.0 — 2026-09-23

### Minor changes

- [39d096a](https://github.com/imjlk/listmonk-ops/commit/39d096a6a6cc84badab628c6474cadbea2ddb693) Add target-bound transactional record inspection and explicit audited operator reconciliation while retaining ambiguous claims past TTL in both file and Postgres stores. — Thanks @imjlk!
- [2848b54](https://github.com/imjlk/listmonk-ops/commit/2848b54d7cc9677a18a5c433aa43432525d74c80) Add shared CLI/MCP connection profiles with secret-free configuration provenance, environment or token-file credential references, and token reload between operations. Isolate default file-backed state by profile and expose config show / listmonk_config. — Thanks @imjlk!

### Patch changes

- [ddc7535](https://github.com/imjlk/listmonk-ops/commit/ddc7535680fbf5a84f2a543071db6fe1f476e260) Upgrade operation contract generation to Typia 15 and align CI, native CLI builds, release publishing, and worker examples on Bun 1.4.2. Keep the TypeScript 5.9 OpenAPI compatibility pin and current ttsc 0.30.4 toolchain.
  
  Refresh GitHub release tooling and run native CLI contract tests before merge. The updated Sampo action regenerates Bun lockfiles directly instead of relying on the legacy install workaround.
  
  Write JSON output through the stdout stream so large catalog responses are fully drained before the CLI exits on Linux. — Thanks @imjlk!
- [f70ca62](https://github.com/imjlk/listmonk-ops/commit/f70ca62f05ca2bb325485c88b8649efd050dbe80) Keep CLI machine output parseable: omit banners, serialize empty resource lists, and report bounded errors on stderr without runtime source dumps. Verify source and native binary output contracts.
  
  Route auxiliary diagnostics through the CLI boundary: JSON buffers one bounded stderr document; NDJSON streams bounded records with semantic levels. Long-running workers require NDJSON, human, or quiet mode. Rollback and cleanup failures never dump raw error stacks into machine output. — Thanks @imjlk!

## 0.6.1 — 2026-09-22

### Patch changes

- [6ae61e8](https://github.com/imjlk/listmonk-ops/commit/6ae61e80c2cc291a33024cd67c760d536066b54b) Refresh runtime and compiler dependencies, regenerate the Fetch SDK, and align the Gunshi completion peer version. Preserve the OpenAPI generator TypeScript 5.9 compatibility dependency.
  
  The regenerated raw SDK now correctly marks request/response as optional on failures that occur before a request or response exists. Raw SDK consumers must guard these fields when inspecting errors.
  
  Preserve required MCP input metadata under Zod 4.6 and keep transactional serialization failures classified as invalid_message under the regenerated SDK. — Thanks @imjlk!

## 0.6.0 — 2026-08-25

### Minor changes

- [e00a24a](https://github.com/imjlk/listmonk-ops/commit/e00a24a58bd341227d6a48738c80579bb8500c65) Promote `lists.create` from experimental to stable with a store-backed idempotency key. A new file-backed resource-create idempotency store in `@listmonk-ops/common` (schema-versioned, atomic writes, configured with `LISTMONK_OPS_RESOURCE_CREATE_STORE` and a `LISTMONK_OPS_RESOURCE_CREATE_STORE_MAX_RECORDS` soft cap, namespaced by the resolved Listmonk target) atomically claims `idempotency_key` (CLI `--idempotency-key`) before the create is issued and then binds it to the created list id: an identical retry replays that list as `created: false` without a second POST, a concurrent same-key create waits for the in-flight one instead of issuing a second POST, and a different payload or target under the same key is rejected explicitly. A live same-host claim (verified past PID reuse) is never stolen by age; an attempt that ends ambiguously — or whose accepted response carries neither an id nor an immutable uuid to correlate — marks its claim unknown, and later same-key creates fail fast with reconciliation guidance: the key is intentionally not reused, because no name-based check can prove which same-named list a create produced. Keyed creates require the injected store, so surfaces without one reject the key instead of silently dropping the guarantee. Unkeyed creates keep the honestly unsafe classification because Listmonk list names are not unique. The output contract gains the `created` envelope, and the CLI/MCP inject the store at their boundaries. The stable TypeScript contract count rises from 83 to 84. — Thanks @imjlk!

## 0.5.1 — 2026-07-30

### Changed

- [ca7e076](https://github.com/imjlk/listmonk-ops/commit/ca7e07630293cba676ca4962ed005583012ddee0) Update the shared esbuild toolchain to the patched 0.28.1 release — Thanks @imjlk!

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

## 0.4.0 — 2026-07-27

### Minor changes

- [763ad72](https://github.com/imjlk/listmonk-ops/commit/763ad726e96e01fe91a0a95fe81935ea1d10e2b1) Add global --format human|json|ndjson|quiet flag for stream-aware CLI output. JSON and NDJSON modes send data to stdout and human messages to stderr. Quiet mode suppresses all non-error human output. All command handlers now route through getOutput() instead of OutputUtils directly. — Thanks @imjlk!

## 0.3.0 — 2026-07-23

### Added

- [b52b7f1](https://github.com/imjlk/listmonk-ops/commit/b52b7f1fa9e3a34c4c3c99e70eca7a2b094d38c1) Add execution policy metadata and atomic operation audit storage — Thanks @imjlk!

## 0.2.0 — 2026-07-20

### Added

- [d227f35](https://github.com/imjlk/listmonk-ops/commit/d227f35985afb8c95472991e579f28569c86afdc) Add schema-aware atomic JSON persistence with recoverable cross-process locks,
  migrate automation stores, and share transactional A/B state across CLI and
  MCP workflows. — Thanks @imjlk!

## 0.1.3 — 2026-03-14

### Changed

- [b225654](https://github.com/imjlk/listmonk-ops/commit/b225654b985bc3f5601af131dfccb53e53f2f093) Refresh workspace dependencies, add Renovate-based dependency automation, and generate Sampo changesets automatically for dependency PRs that touch releasable packages. — Thanks @imjlk!

## 0.1.2 — 2026-03-14

### Changed

- [3b22b2c](https://github.com/imjlk/listmonk-ops/commit/3b22b2c455c5883e182702eb0bb7355e52528c91) Mark executable packages as Bun-targeted where applicable, harden automation workflows against empty upstream responses, add atomic rollback to A/B test provisioning, and improve package metadata for library consumers. — Thanks @imjlk!

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

