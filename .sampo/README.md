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
4. GitHub Actions workflow `.github/workflows/sampo-release-publish.yml` runs:
   - `sampo release`
   - `bun run build`
   - `sampo publish -- --access public --provenance`
   - pushes release commit and tags after publish succeeds
5. Optional local/manual path:
   - `bun run release:apply`
   - `bun run release:publish`

## Notes

- CI checks that changes touching releasable packages include a changeset file under `.sampo/changesets/`.
- npm publishing is automated via OIDC trusted publishing in GitHub Actions.
