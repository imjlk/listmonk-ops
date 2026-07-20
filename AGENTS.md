# Repository agent guide

This file applies to the entire repository. `CLAUDE.md` and `GEMINI.md` must
remain symbolic links to this file so supported coding agents receive the same
instructions.

## Project snapshot

`listmonk-ops` is a TypeScript/Bun monorepo for operating Listmonk. Its two
user-facing surfaces are a Gunshi CLI and an MCP server. They should share
domain behavior rather than grow separate implementations.

There is no web dashboard in this repository. Do not introduce or document one
unless the task explicitly adds it.

### Repository map

- `apps/cli`: Bun/Gunshi CLI, shell completion, JS bundle, and native binaries.
- `packages/openapi`: generated Listmonk SDK plus handwritten client wrappers.
- `packages/operations`: shared typed operation contracts and runtime-neutral
  executors used by CLI and MCP adapters.
- `packages/automation`: high-level operational workflows such as campaign
  preflight, deliverability guard, hygiene, drift, templates, and digest.
- `packages/abtest`: A/B test lifecycle, Listmonk integration, and statistics.
- `packages/mcp`: stdio and Streamable HTTP MCP server and tool handlers.
- `packages/common`: runtime-neutral shared utilities.
- `scripts`: repository checks, local-stack bootstrap, and smoke tests.
- `docker-compose.yml`: local Listmonk 6.2.0, PostgreSQL, and Mailpit stack.

Executable packages (`apps/cli` and `packages/mcp`) target Bun. Library
packages should remain runtime-neutral ESM unless a task requires otherwise.

## Working agreement

1. Start from an up-to-date `main` and work on a feature branch. Never push
   feature work directly to `main`.
2. Inspect the working tree before editing. Preserve unrelated user changes and
   local-only files.
3. Keep each commit focused and reviewable. Run the checks appropriate to its
   scope before committing.
4. If a PR changes a releasable workspace under `apps/cli` or the listed
   `packages/*`, add a Sampo changeset with `bun run release:add`. The current
   guard treats package READMEs and other package documentation as releasable
   changes too. Root documentation and repository infrastructure outside those
   workspaces do not need a changeset.
5. Open a PR against `main`, wait for CI and review, address actionable
   findings, and request review again. Merge only after required checks pass.
6. After merge, fast-forward local `main` from `origin/main`. The release
   workflow may add another commit to `main` after publishing.

## Toolchain and quality gates

The first-party compiler workflow pins TypeScript 7 and uses `ttsc`,
`@ttsc/lint`, and `@ttsc/graph`. Biome, ESLint, and Prettier are not part of the
toolchain. `packages/openapi` intentionally keeps a nested TypeScript 5.9
dependency because `@hey-api/openapi-ts` still imports the legacy compiler API
during generation. Do not remove or upgrade that compatibility dependency as
part of routine TypeScript 7 maintenance.

Run commands from the repository root unless noted otherwise:

```bash
bun install                 # install the locked workspace
bun run format              # write first-party TS/JS formatting
bun run lint                # ttsc lint diagnostics
bun run typecheck           # TypeScript 7 monorepo type check
bun run check               # lint + typecheck + graph integrity
bun run build               # build every workspace
bun run test                # package unit/contract tests
bun run test:e2e            # MCP E2E tests; local Listmonk required
```

`bun run format` is a write operation. After running it, inspect the diff and
make sure it did not touch unrelated files. CI runs the formatter and rejects a
resulting diff.

Use the narrowest useful test while iterating, then run the broader gate that
matches the change. Examples:

```bash
bun test packages/automation/tests/workflows.test.ts
bun run --cwd apps/cli test
bun run --cwd packages/mcp test
```

## Compiler graph workflow

Use the `ttsc-graph` MCP server early when a change crosses packages or affects
shared symbols. The checked-in Codex and MCP configurations start it through
`bun run graph:mcp` with `tsconfig.graph.json`.

Useful local equivalents:

```bash
bun run graph:dump
bun run graph:view
bun run graph:check
```

Use graph queries to:

- map package and symbol dependencies before changing shared code;
- find callers, public APIs, hotspots, and likely blast radius;
- connect named implementation symbols to direct-import tests;
- verify new TypeScript tests remain part of the graph program.

The graph complements, rather than replaces, `rg`, source inspection, and
runtime tests. Text/config references, object-literal callbacks, dynamically
dispatched commands, and subprocess-based CLI tests can have weak or no static
symbol edges. Prefer named exported actions and direct-import unit tests for
new shared behavior while retaining black-box CLI and MCP integration tests.

`tsconfig.graph.json` intentionally includes first-party TypeScript tests as
usage anchors and excludes `packages/openapi/generated`. Do not add generated
or build output to the main graph merely to increase coverage. If generated SDK
debugging needs a graph, use a separate opt-in graph configuration.

If the graph tool is unavailable after the first install, restart the coding
client. Fall back to `bun run graph:dump` and `rg` without blocking the task.

## Architecture rules

### Shared operations

- Put reusable operational behavior in a domain package, not directly in a CLI
  command or MCP transport handler.
- Keep surface adapters thin: parse and validate input, invoke a named domain
  operation, and serialize its result.
- When a behavior is available through both CLI and MCP, share its input/output
  contract and executor. Do not maintain two subtly different workflows.
- Prefer small named exports over large anonymous switches or object-literal
  callbacks. This improves direct testing and graph impact analysis.
- Keep runtime context, authentication, and transport concerns outside domain
  functions.

For new or migrated MCP operations, define human-readable titles, explicit
input and output schemas, structured results, and safety metadata such as
read-only, destructive, and idempotent behavior. Destructive tools must not be
made to look like read-only queries.

### OpenAPI boundary

`packages/openapi/generated` is generated by Hey API. Do not edit it manually.
Regenerate with:

```bash
bun run --cwd packages/openapi generate
```

Update the versioned upstream specification or the documented overlay under
`packages/openapi/spec` when generation inputs change. CI verifies that
regeneration produces no diff.

Listmonk's upstream schema may be incomplete or inconsistent with observed
responses. Do not distort production domain types merely to silence generated
or test-only diagnostics. Prefer narrow handwritten adapters, runtime guards,
and realistic test fixtures at the OpenAPI boundary.

### Persistence and concurrency

CLI and MCP flows that use the same state must use one persistence contract.
Avoid duplicate read/modify/write implementations. File-backed state should be
schema-versioned and written atomically; consider locking when concurrent MCP
requests can update it.

### MCP transports

Stdio is the preferred local integration. The HTTP transport is loopback-bound
by default. Do not expose it beyond localhost without explicit origin
validation, authentication, and deployment guidance. Keep authorization and
safety checks at the request boundary, not only in documentation.

## Local Listmonk and Mailpit tests

The existing Compose stack is the canonical integration environment. Reuse it
for CLI/MCP parity and operation-registry tests instead of inventing mocks for
behavior that depends on Listmonk.

```bash
docker compose up -d
bun run stack:bootstrap-auth
./setup-smtp.sh
```

Local endpoints:

- Listmonk health/API: `http://localhost:9000/health` and `/api`
- Listmonk admin: `http://localhost:9000/admin`
- Mailpit UI/HTTP API: `http://localhost:8025`
- Mailpit SMTP: `localhost:1025`

The checked-in credentials and permissive Mailpit SMTP settings are test-only.
Compose binds published ports to `127.0.0.1` by default. Never aim destructive,
send, or cleanup tests at a non-local Listmonk instance unless the user has
explicitly authorized that exact target.

Available integration levels:

```bash
bun run ops:smoke       # quick, read-oriented CLI smoke checks
bun run test:e2e        # MCP tests against the local stack
bun run ops:smoke:full  # creates resources and exercises send/lifecycle flows
```

Use Mailpit for delivery assertions so integration tests never send real mail.
When adding CLI/MCP parity coverage, run the same shared operation through both
adapters against the local stack and compare stable contract fields rather than
timestamps or generated IDs. Ensure created fixtures are uniquely prefixed and
cleaned up when the API supports it.

CI starts this Compose stack, bootstraps an API token, runs the quick CLI smoke,
and then runs MCP E2E. Keep the local commands aligned with `.github/workflows/ci.yml`.

## Documentation and generated artifacts

- Update both English and Korean user documentation when user-visible behavior
  changes: `README.md` / `README_ko.md` and, when applicable,
  `CONTRIBUTING.md` / `CONTRIBUTING_ko.md`.
- Keep `CLAUDE.md` and `GEMINI.md` as relative symbolic links to `AGENTS.md`;
  do not duplicate agent instructions.
- Do not commit `dist`, package archives, logs, local environment files, or
  generated smoke reports unless the task explicitly requires an artifact
  update and the file is intentionally tracked.
- Do not hand-edit generated OpenAPI files or Sampo release outputs.

## Before handing off a PR

At minimum:

1. Review `git diff` and verify only intended files are present.
2. Run formatting, checks, tests, and builds in proportion to the change.
3. Run OpenCodeReview on each logical commit and address valid high/medium
   findings.
4. Add a Sampo changeset when a releasable package changed.
5. Push the branch and open the PR as ready for review, not draft, unless work
   is intentionally incomplete.
6. Verify all required CI checks and unresolved review threads before merging.
