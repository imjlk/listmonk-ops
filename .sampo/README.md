# Sampo In This Repository

This repository uses Sampo for changeset and version planning.

## Release Target Scope

Managed release packages:

- `@listmonk-ops/cli`
- `@listmonk-ops/openapi`
- `@listmonk-ops/automation`
- `@listmonk-ops/common`
- `@listmonk-ops/abtest`
- `@listmonk-ops/mcp`

Currently, no additional package ignore rules are configured.

## Typical Flow

1. Add changeset on feature PR
   - `bun run release:add`
2. Validate release impact
   - `bun run release:plan`
3. Merge PR into `main`
4. GitHub Actions workflow `.github/workflows/sampo-release-publish.yml` creates or refreshes the `sampo/release` PR.
   - Additional feature PRs keep accumulating their changesets in the same release PR.
   - Package versions and changelogs are reviewed in the release PR before publishing.
5. Merge `sampo/release` when the accumulated changes are ready to publish.
6. The workflow runs again on the release PR merge:
   - builds all workspaces with Bun
   - packs publishable packages with Bun
   - publishes the tarballs with npm OIDC trusted publishing
   - creates and pushes package version tags
7. Optional local/manual path:
   - `bun run release:apply`
   - `bun run release:publish`

## Notes

- CI checks that changes touching releasable packages include a changeset file under `.sampo/changesets/`.
- The `sampo/release` PR is the manual gate for each grouped release.
- npm publishing is automated via OIDC trusted publishing in GitHub Actions.
