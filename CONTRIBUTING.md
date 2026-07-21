# Contributing

English | [한국어](./CONTRIBUTING_ko.md)

This repository uses a PR-first workflow.

## Default Flow

1. Start from the latest `main`.
2. Create a feature branch.
3. Make your changes.
4. If you touched a releasable package, add a Sampo changeset.
5. Open a PR targeting `main`.
6. Merge the PR after CI passes.
7. Let GitHub Actions handle release versioning, npm publish, and tags.

Do not push feature work directly to `main`.

## Releasable Packages

Changesets are required when a PR changes any of these:

- `apps/cli`
- `packages/openapi`
- `packages/operations`
- `packages/common`
- `packages/abtest`
- `packages/automation`
- `packages/mcp`

Add one with:

```bash
bun run release:add
```

Check the release plan locally if needed:

```bash
bun run release:plan
```

Renovate PRs are the exception:

- Renovate opens dependency PRs automatically.
- If a Renovate PR changes a releasable package, `.github/workflows/renovate-changeset.yml` commits a generic changeset onto the PR branch.
- Human-authored PRs should still add their own changesets directly.

## CI And Release

PR validation:

- `CI`
- `Sampo Changeset Check`

After merge to `main`:

1. `.github/workflows/sampo-release-publish.yml` runs.
2. It applies `sampo release`.
3. It builds with Bun.
4. It publishes npm packages with OIDC trusted publishing.
5. It pushes the release commit and tags after publish succeeds.

CLI release binaries:

- `.github/workflows/cli-github-release.yml` builds the scoped
  `@listmonk-ops/cli-v*` tag on tag pushes or explicit dispatches.
- Sampo explicitly dispatches that workflow after publishing a new CLI tag;
  tags created with `GITHUB_TOKEN` do not start another workflow by themselves.

## Local Development

Typical commands:

```bash
bun install
bun run check
bun run build
bun run test
```

### TypeScript 7 and ttsc

The repository pins TypeScript 7 and uses `ttsc` for compiler-powered type
checking, linting, and formatting. Biome, ESLint, and Prettier are not part of
the development toolchain.

```bash
# Format first-party TypeScript and JavaScript files
bun run format

# Check lint rules without semantic type diagnostics
bun run lint

# Apply safe lint fixes and formatting, then re-run lint
bun run lint:fix

# Type-check every workspace with TypeScript 7
bun run typecheck

# Local quality gate: lint + typecheck (CI checks formatting separately)
bun run check
```

Lint and formatter behavior lives in `lint.config.ts`. `tsconfig.quality.json`
defines the first-party TypeScript and JavaScript files covered by formatting
and linting; generated and build output remain excluded. Formatting is a write
operation, so CI runs `bun run format` and rejects the resulting diff before
running `bun run check`.

`tsconfig.typecheck.json` maps internal workspace packages to their source
entry points and checks the monorepo as one program. A clean checkout therefore
does not need prebuilt `dist/*.d.ts` files before `bun run typecheck`.

Workspace compiler and declaration builds invoke `ttsc`. The Bun-bundled CLI's
top-level build runs `ttsc --noEmit` before bundling, and the native release
workflow repeats that gate before producing artifacts.

The `packages/openapi` workspace keeps a nested TypeScript 5.9 compatibility
runtime solely because `@hey-api/openapi-ts` imports the legacy JavaScript
compiler API while generating code. Bun's isolated workspace linker keeps that
runtime and its peer resolution inside the OpenAPI package. Its `build`,
`lint`, and `typecheck` scripts still invoke `ttsc` and therefore compile with
TypeScript 7.

For VS Code, install the recommended `samchon.ttsc` extension. The checked-in
workspace settings use it for TypeScript format-on-save.

### TypeScript code graph

`@ttsc/graph` is available to coding agents and for local architecture
inspection. `tsconfig.graph.json` maps workspace packages to their source entry
points so graph results follow source-to-source relationships instead of built
artifacts.

```bash
# Stream the compiler-resolved graph as JSON
bun run graph:dump

# Open the local interactive graph viewer
bun run graph:view

# Include generated OpenAPI SDK files as explicit debugging roots
bun run graph:openapi:dump

# Verify graph roots and the CLI/MCP -> operation -> OpenAPI call contract
bun run graph:check
```

The list-operation pilot intentionally exposes named operation invokers. The
main graph contract verifies that CLI and MCP adapters reach those invokers,
the handwritten OpenAPI boundary, and direct-import tests through real call
edges. Keep these named boundaries when extending the registry; callback-only
registration is not a substitute because the compiler graph cannot follow the
runtime dispatch across that callback.

Codex loads the server from `.codex/config.toml` in a trusted checkout. Claude
Code-compatible clients can use `.mcp.json`. Both configurations run the local
locked dependency through `bun run graph:mcp`; restart the client after the
first `bun install` if the graph tool is not visible. The MCP process snapshots
the graph at startup, so restart the client after switching branches or
changing graph configuration if results look stale. Use the dump commands for
a fresh snapshot before restarting.

If you need the local Listmonk stack:

```bash
docker compose up -d
./setup-smtp.sh
```

Optional checks:

```bash
bun run test:e2e
bun run ops:smoke
```

## After Merge

This repository creates a bot-authored release commit on `main` after a successful publish.

That means your local branch can fall behind `origin/main` even if your PR was just merged.

Before starting the next task, update locally:

```bash
git checkout main
git pull --ff-only origin main
```
