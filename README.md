# Listmonk Operations Monorepo

English | [한국어](./README_ko.md)

Production-oriented tooling for operating [Listmonk](https://listmonk.app/) with a single TypeScript/Bun monorepo.

Contribution guide: [CONTRIBUTING.md](./CONTRIBUTING.md) | [한국어](./CONTRIBUTING_ko.md)

This repository includes:
- OpenAPI-based SDK generation (Hey API)
- A/B testing domain logic
- MCP server for tool-based integrations
- Gunshi-based CLI with shell completions and standalone binary builds
- Dockerized local Listmonk environment (Listmonk + Postgres + Mailpit)

## Built Around Listmonk

This repository is designed for teams operating [Listmonk](https://listmonk.app/) in production.

- Listmonk project: [listmonk.app](https://listmonk.app/)
- Source code: [knadh/listmonk](https://github.com/knadh/listmonk)

## Components

| Path | Purpose |
| --- | --- |
| `apps/cli` | `listmonk-cli` command line app (Gunshi) |
| `packages/openapi` | Generated API SDK and typed client wrappers |
| `packages/operations` | Shared typed operation contracts and executors for CLI/MCP adapters |
| `packages/abtest` | A/B test services and analysis logic |
| `packages/automation` | `@listmonk-ops/automation` high-level operational workflows (preflight/guard/hygiene/drift/digest) |
| `packages/mcp` | MCP server exposing Listmonk operations |
| `packages/common` | Shared utilities, validation helpers, and atomic JSON persistence |

Runtime policy:
- Executable packages (`apps/cli`, `packages/mcp`) target the Bun runtime.
- Library packages are ESM. `openapi` and `operations` remain runtime-neutral; the file-backed APIs in `common`, `automation`, and `abtest` require a Node-compatible file-system runtime such as Bun.

## Prerequisites

- Bun 1.3+
- Docker and Docker Compose

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
- PostgreSQL: Docker-internal `db:5432` only

Published ports bind to `127.0.0.1` by default because the local stack uses
fixed bootstrap credentials. Set `LISTMONK_BIND_ADDRESS` explicitly only when
you intend to expose the test stack beyond the current machine.

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
# Optional: override shared CLI/MCP state files
export LISTMONK_OPS_ABTEST_STORE="$HOME/.listmonk-ops/abtests.json"
export LISTMONK_OPS_SEGMENT_STORE="$HOME/.listmonk-ops/ops/segment-drift.json"
export LISTMONK_OPS_TEMPLATE_REGISTRY="$HOME/.listmonk-ops/ops/template-registry.json"
# Optional: override the metadata-only MCP operation audit store
export LISTMONK_OPS_AUDIT_STORE="$HOME/.listmonk-ops/operation-audit.json"
```

You can create/manage tokens in the Listmonk admin UI.

The A/B test, segment drift, and template registry stores use versioned JSON,
atomic replacement, and cross-process write locks so CLI and MCP processes can
share the same local state without losing concurrent updates. Invalid or newer
schemas are rejected instead of being overwritten.

Shared MCP operation audit events use the same atomic persistence mechanism.
They retain execution metadata only, never request inputs, outputs,
credentials, or remote error text.

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
curl -fsSL https://raw.githubusercontent.com/imjlk/listmonk-ops/main/scripts/install-listmonk-cli.sh | bash -s -- --version 0.3.0
```

## MCP Runtime Endpoint Override

`listmonk-mcp` supports runtime flags, so local Docker Listmonk is not required.
The published npm package still requires `bun` on `PATH` at runtime:

```bash
listmonk-mcp \
  --listmonk-url https://listmonk.example.com/api \
  --listmonk-username api-admin \
  --listmonk-api-token <token> \
  --host 0.0.0.0 \
  --port 3000
```

Use `listmonk-mcp --stdio` for command-based MCP clients. The default HTTP
runtime exposes the standard Streamable HTTP endpoint at `/mcp` while retaining
the legacy REST endpoints.

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
- PRs changing releasable packages (`apps/cli`, `packages/openapi`, `packages/operations`, `packages/automation`, `packages/common`, `packages/abtest`, `packages/mcp`) must include `.sampo/changesets/*.md`
- Workflow: `.github/workflows/sampo-changeset-check.yml`
- Renovate PRs that touch releasable packages receive a bot-generated changeset via `.github/workflows/renovate-changeset.yml`

npm Trusted Publishing setup required (one-time on npm):
- Provider: GitHub Actions
- Repository: `imjlk/listmonk-ops`
- Workflow file: `.github/workflows/sampo-release-publish.yml`

## Dependency Automation

This repository uses Renovate for npm/Bun/GitHub Actions updates.

- Config: `renovate.json`
- Schedule: first and third Monday morning in `Asia/Seoul` (bi-weekly approximation)
- Automerge: patch, pin, digest, and lockfile maintenance updates after required checks pass
- `gunshi` and `@gunshi/plugin-completion` updates require dependency dashboard approval and should pass CLI contract, binary, and package-size checks

## Operational Baseline

For sustainable operation, keep these checks in your regular loop:

```bash
# Lint/typecheck with TypeScript 7 and ttsc
bun run check

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
- Uses `LISTMONK_API_TOKEN` or the token file produced by `bun run stack:bootstrap-auth`
- Supports mode switch with `LISTMONK_OPS_SMOKE_MODE=quick|full`
- Writes JSON report to `${LISTMONK_OPS_SMOKE_REPORT:-/tmp/listmonk-ops-smoke/report.json}`

CI now enforces:
- OpenAPI generation drift detection
- Workspace build/test
- Docker-based local stack smoke on every push/PR

## CLI Build Pipeline (JS + Single Binary)

`apps/cli` uses Gunshi and supports both a Bun runtime bundle and native standalone binaries.

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
# - dist/bin/listmonk-cli-linux-x64
# - dist/bin/listmonk-cli-linux-arm64
# - dist/bin/listmonk-cli-darwin-x64
# - dist/bin/listmonk-cli-darwin-arm64
```

## Shell Completions (CLI)

```bash
# Generate completion script
listmonk-cli complete zsh
listmonk-cli complete bash
listmonk-cli complete fish
listmonk-cli complete powershell

# Example (zsh)
source <(listmonk-cli complete zsh)
```

The deprecated `completions` spelling remains an alias for migration compatibility.

## Subscriber Lists

The CLI exposes the same typed subscriber-list operations as the MCP server:

```bash
listmonk-cli lists list --page 1 --per-page 20
listmonk-cli lists get --id 10
listmonk-cli lists create --name "Product updates" --type private --optin single
listmonk-cli lists update --id 10 --name "Product updates" --confirm
listmonk-cli lists delete --id 10 --confirm
```

Campaign, subscriber, and template CRUD now use the same typed operations on
both surfaces. Uploaded media read/delete operations use the same contracts as
well. The CLI includes the full CRUD command set where Listmonk exposes it:

```bash
listmonk-cli campaigns list --page 1 --per-page 20
listmonk-cli campaigns create --name "Weekly update" --subject "News" \
  --from-email ops@example.com --body "<p>Hello</p>" \
  --template-id 1 --lists 10
listmonk-cli campaigns update --id 42 --subject "Updated news"
listmonk-cli campaigns delete --id 42 --confirm

listmonk-cli subscribers create --email reader@example.com --name Reader
listmonk-cli subscribers update --id 7 --status enabled
listmonk-cli subscribers delete --id 7 --confirm

listmonk-cli templates create --name "Campaign HTML" --body "<p>Hello</p>"
listmonk-cli templates update --id 3 --body "<p>Updated</p>"
listmonk-cli templates delete --id 3 --confirm
listmonk-cli templates set-default --id 3

listmonk-cli media list --page 1 --per-page 20
listmonk-cli media get --id 9
listmonk-cli media delete --id 9 --confirm
```

The corresponding MCP resource tools include
`listmonk_get_campaigns`, `listmonk_get_campaign`,
`listmonk_create_campaign`, `listmonk_update_campaign`,
`listmonk_delete_campaign`, the equivalent `subscriber` and `template` names,
and `listmonk_get_media`, `listmonk_get_media_file`, and
`listmonk_delete_media`. Their results include structured content while
retaining compatible legacy success text for destructive mutations.

## Shared Operation Discovery

Use the credential-free catalog command to see the typed operations available
through both surfaces, including each operation's MCP name, input/output
schema, safety hints, and execution policy (`confirmationRequired`,
`auditRequired`, and `dryRunSupported`):

```bash
listmonk-cli operations
listmonk-cli operations --family campaigns
```

MCP clients can call the read-only `listmonk_list_operations` tool with the
same optional `family` filter. The catalog intentionally covers shared typed
operations only; legacy transport-specific tools remain available separately.

For a destructive shared MCP operation, include the MCP-only
`"confirm": true` input. The adapter removes that control before invoking the
typed domain operation. A `dry_run: true` request is accepted only when the
cataloged operation explicitly supports a real dry run; unsupported dry-run
requests are rejected instead of being simulated. Mutating shared MCP
operations append `started`, `blocked`, `succeeded`, or `failed` metadata-only
events to `$HOME/.listmonk-ops/operation-audit.json` by default. The staged
migration deliberately leaves legacy transport-specific MCP tools unchanged.

The CLI applies the same policy to its shared operations. Pass the global
`--confirm` flag for any cataloged command whose `confirmationRequired` policy
is true; it is consumed at the CLI boundary and never forwarded to the domain
input. Writes append the same metadata-only audit events to the same default
store. Set `LISTMONK_OPS_AUDIT_STORE` to use a different local audit path.
For example, the hygiene preview is still a destructive-capable operation and
therefore needs explicit confirmation:

```bash
listmonk-cli ops hygiene --mode winback --dry-run true --confirm
```

## Transactional Email

The CLI and MCP server share one typed transactional-send operation. Both
surfaces accept the same recipient, template data, content type, and custom
header payloads:

```bash
listmonk-cli tx send \
  --template-id 42 \
  --subscriber-email recipient@example.com \
  --from-email "Ops <ops@example.com>" \
  --content-type html \
  --data '{"name":"Ada"}' \
  --headers '[{"X-Trace-ID":"example-trace"}]'
```

The email or ID selector targets an existing Listmonk subscriber.

The corresponding MCP tool is `listmonk_send_transactional`. It returns
`{"sent": true}` as structured content while retaining the legacy boolean text
result for existing clients.

## A/B Test Operations

CLI `abtest` group now supports full lifecycle operations:

```bash
listmonk-cli abtest list
listmonk-cli abtest get --test-id <id>
listmonk-cli abtest create ... --confirm
listmonk-cli abtest launch --test-id <id> --confirm
listmonk-cli abtest stop --test-id <id> --confirm
listmonk-cli abtest analyze --test-id <id>
listmonk-cli abtest recommend-sample-size \
  --lists 123,456 --test-group-percentage 10 --variant-count 2
listmonk-cli abtest deploy-winner --test-id <id> --confirm
listmonk-cli abtest delete --test-id <id> --confirm
```

Creating with `--auto-launch true` starts the backing campaigns immediately;
review that flag as a sending operation before using it in automation.

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
listmonk-cli ops guard --campaign-id 123 --pause-on-breach true --confirm

# 3) Subscriber hygiene (preview)
listmonk-cli ops hygiene --mode winback --dry-run true --inactivity-days 90 --confirm

# 4) Segment drift snapshot
listmonk-cli ops segment-drift --threshold 0.2 --min-absolute-change 50

# 5) Template registry/versioning
listmonk-cli ops templates-sync
listmonk-cli ops templates-history --template-id 10
listmonk-cli ops templates-promote --template-id 10 --version-id v_... --confirm
listmonk-cli ops templates-rollback --template-id 10 --confirm

# 6) Daily digest
listmonk-cli ops digest --hours 24 --output /tmp/listmonk-ops-digest.md
```

## OpenAPI Regeneration (Hey API)

The SDK is generated by `@hey-api/openapi-ts`.

1. Update the tagged upstream file or project overlay described in:
   - `packages/openapi/spec/README.md`
2. Regenerate client/SDK:

```bash
bun run --cwd packages/openapi generate
```

Generated artifacts are written to:
- `packages/openapi/generated/*`

The default compiler graph keeps handwritten OpenAPI modules and TypeScript
tests as explicit roots. Use `bun run graph:coverage` to verify that shared
operation registries remain connected to MCP adapters and direct-import tests.
To inspect generated SDK internals as graph roots, use the separate debug
configuration:

```bash
# Verify shared operation registry, MCP adapter, and direct test anchors
bun run graph:coverage

# Inspect generated SDK internals as explicit graph roots
bun run graph:openapi:dump
bun run graph:openapi:view
```

## MCP Server

Start development server:

```bash
bun run --cwd packages/mcp dev
```

Common endpoints:
- `GET /health`
- `/mcp` (standard MCP Streamable HTTP)
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
