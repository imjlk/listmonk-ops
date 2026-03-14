# Listmonk Operations Monorepo

English | [한국어](./README_ko.md)

Production-oriented tooling for operating [Listmonk](https://listmonk.app/) with a single TypeScript/Bun monorepo.

Contribution guide: [CONTRIBUTING.md](./CONTRIBUTING.md) | [한국어](./CONTRIBUTING_ko.md)

This repository includes:
- OpenAPI-based SDK generation (Hey API)
- A/B testing domain logic
- MCP server for tool-based integrations
- Bunli-based CLI with shell completions and standalone binary builds
- Dockerized local Listmonk environment (Listmonk + Postgres + Mailpit)

## Built Around Listmonk

This repository is designed for teams operating [Listmonk](https://listmonk.app/) in production.

- Listmonk project: [listmonk.app](https://listmonk.app/)
- Source code: [knadh/listmonk](https://github.com/knadh/listmonk)

## Components

| Path | Purpose |
| --- | --- |
| `apps/cli` | `listmonk-cli` command line app (Bunli) |
| `packages/openapi` | Generated API SDK and typed client wrappers |
| `packages/abtest` | A/B test services and analysis logic |
| `packages/automation` | `@listmonk-ops/automation` high-level operational workflows (preflight/guard/hygiene/drift/digest) |
| `packages/mcp` | MCP server exposing Listmonk operations |
| `packages/common` | Shared utilities and error/validation helpers |

## Prerequisites

- Bun 1.3+
- Docker and Docker Compose
- Node.js 18+ (for `packages/mcp` production start script)

## Quick Start

```bash
# 1) Install dependencies
bun install

# 2) Start local Listmonk stack
docker compose up -d

# 3) Configure SMTP for Mailpit
./setup-smtp.sh
```

Local endpoints:
- Listmonk Admin: `http://localhost:9000/admin`
- Listmonk API: `http://localhost:9000/api`
- Mailpit UI: `http://localhost:8025`
- Mailpit SMTP: `localhost:1025`
- PostgreSQL: `localhost:5432`

Default admin credentials from `docker-compose.yml`:
- Username: `admin`
- Password: `adminpass`

## Environment Variables

CLI/OpenAPI client use token-based auth:

```bash
export LISTMONK_API_URL="http://localhost:9000/api"
export LISTMONK_USERNAME="api-admin"
export LISTMONK_API_TOKEN="<your-token>"
# Optional: suppress A/B statistical console logs in automation
export LISTMONK_OPS_ABTEST_SILENT="1"
```

You can create/manage tokens in the Listmonk admin UI.

## Workspace Commands

From repository root:

```bash
# CLI
bun run cli -- status
bun run cli -- campaigns list
bun run cli -- ops digest --hours 24

# OpenAPI package
bun run api generate
bun run api test

# MCP package
bun run mcp dev
bun run mcp test:e2e
```

## CLI Binary Install (GitHub Release + curl)

```bash
curl -fsSL https://raw.githubusercontent.com/imjlk/listmonk-ops/main/scripts/install-listmonk-cli.sh | bash
```

Optional version pin:

```bash
curl -fsSL https://raw.githubusercontent.com/imjlk/listmonk-ops/main/scripts/install-listmonk-cli.sh | bash -s -- --version 0.2.0
```

## MCP Runtime Endpoint Override

`listmonk-mcp` supports runtime flags, so local Docker Listmonk is not required:

```bash
listmonk-mcp \
  --listmonk-url https://listmonk.example.com/api \
  --listmonk-username api-admin \
  --listmonk-api-token <token> \
  --host 0.0.0.0 \
  --port 3000
```

## Sampo Changesets + npm OIDC Publish

This repo uses Sampo for release planning/changelog management and automated npm publishing on `main`.

```bash
# 1) Add a changeset in feature PR
bun run release:add

# 2) Validate release impact (dry-run)
bun run release:plan

# 3) (Optional local) Apply version/changelog updates
bun run release:apply

# 4) (Optional local) Publish through npm
bun run release:publish
```

After a PR is merged into `main`, workflow `.github/workflows/sampo-release-publish.yml` runs:

1. `sampo release`
2. `bun run build`
3. `sampo publish -- --access public --provenance`
4. Pushes release commit and tags after publish succeeds

CI guard:
- PRs changing releasable packages (`apps/cli`, `packages/openapi`, `packages/automation`, `packages/common`, `packages/abtest`, `packages/mcp`) must include `.sampo/changesets/*.md`
- Workflow: `.github/workflows/sampo-changeset-check.yml`

npm Trusted Publishing setup required (one-time on npm):
- Provider: GitHub Actions
- Repository: `imjlk/listmonk-ops`
- Workflow file: `.github/workflows/sampo-release-publish.yml`

## Operational Baseline

For sustainable operation, keep these checks in your regular loop:

```bash
# Build every workspace package
bun run build

# Run package tests
bun run test

# Run integration/E2E tests (requires local stack)
bun run test:e2e

# Quick local stack smoke (read-only checks)
bun run ops:smoke

# Full smoke (includes create/analyze flows)
bun run ops:smoke:full
```

Smoke script details:
- File: `scripts/ops-smoke.sh`
- Auto-resolves API token from local Docker DB when `LISTMONK_API_TOKEN` is not set
- Supports mode switch with `LISTMONK_OPS_SMOKE_MODE=quick|full`
- Writes JSON report to `${LISTMONK_OPS_SMOKE_REPORT:-/tmp/listmonk-ops-smoke/report.json}`

CI now enforces:
- OpenAPI generation drift detection
- Workspace build/test
- Docker-based local stack smoke on every push/PR

## CLI Build Pipeline (JS + Single Binary)

`apps/cli` uses Bunli and supports both JS output and native standalone binary.

```bash
# Build everything
bun run --cwd apps/cli build

# Outputs
# - dist/js/index.js          (runtime bundle)
# - dist/bin/listmonk-cli     (native single binary for current platform)
```

Additional scripts:

```bash
# JS-only bundle
bun run --cwd apps/cli build:js

# Native binary for current platform
bun run --cwd apps/cli build:bin

# Native binaries for all supported targets
bun run --cwd apps/cli build:bin:all
```

## Shell Completions (CLI)

```bash
# Generate completion script
listmonk-cli completions zsh
listmonk-cli completions bash
listmonk-cli completions fish
listmonk-cli completions powershell

# Example (zsh)
source <(listmonk-cli completions zsh)
```

## A/B Test Operations

CLI `abtest` group now supports full lifecycle operations:

```bash
listmonk-cli abtest list
listmonk-cli abtest get --test-id <id>
listmonk-cli abtest create ...
listmonk-cli abtest launch --test-id <id>
listmonk-cli abtest stop --test-id <id>
listmonk-cli abtest analyze --test-id <id>
listmonk-cli abtest delete --test-id <id>
```

MCP now also exposes A/B test lifecycle tools:

```text
listmonk_abtest_list
listmonk_abtest_get
listmonk_abtest_create
listmonk_abtest_analyze
listmonk_abtest_launch
listmonk_abtest_stop
listmonk_abtest_delete
listmonk_abtest_recommend_sample_size
listmonk_abtest_deploy_winner
```

## Ops Automation Commands

```bash
# 1) Pre-send gate
listmonk-cli ops preflight --campaign-id 123 --check-links true --fail-on-warn false

# 2) Deliverability guard
listmonk-cli ops guard --campaign-id 123 --pause-on-breach true

# 3) Subscriber hygiene (preview)
listmonk-cli ops hygiene --mode winback --dry-run true --inactivity-days 90

# 4) Segment drift snapshot
listmonk-cli ops segment-drift --threshold 0.2 --min-absolute-change 50

# 5) Template registry/versioning
listmonk-cli ops templates-sync
listmonk-cli ops templates-history --template-id 10
listmonk-cli ops templates-promote --template-id 10 --version-id v_...
listmonk-cli ops templates-rollback --template-id 10

# 6) Daily digest
listmonk-cli ops digest --hours 24 --output /tmp/listmonk-ops-digest.md
```

## OpenAPI Regeneration (Hey API)

The SDK is generated by `@hey-api/openapi-ts`.

1. Update spec file:
   - `packages/openapi/spec/listmonk.yaml`
2. Regenerate client/SDK:

```bash
bun run --cwd packages/openapi generate
```

Generated artifacts are written to:
- `packages/openapi/generated/*`

## MCP Server

Start development server:

```bash
bun run --cwd packages/mcp dev
```

Common endpoints:
- `GET /health`
- `POST /tools/list`
- `POST /tools/call`

See [packages/mcp/README.md](./packages/mcp/README.md) for detailed tool coverage and E2E workflow.

## Troubleshooting

- If CLI requests fail with auth errors, verify `LISTMONK_API_TOKEN` and `LISTMONK_USERNAME`.
- If local Listmonk is not ready, check logs:

```bash
docker compose logs -f listmonk
docker compose logs -f db
```

- Re-run SMTP setup after recreating containers:

```bash
./setup-smtp.sh
```
