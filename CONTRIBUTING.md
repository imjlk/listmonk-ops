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

- `.github/workflows/cli-github-release.yml` runs on `*cli-v*` tags.
- Those tags are created by the Sampo release flow.

## Local Development

Typical commands:

```bash
bun install
bun run build
bun run test
```

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
