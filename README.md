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
| `packages/operations` | Shared typed operation contracts and executors, plus compiler-driven specs for CLI/MCP and agents |
| `packages/abtest` | A/B test services and analysis logic |
| `packages/automation` | `@listmonk-ops/automation` high-level operational workflows (preflight/guard/hygiene/drift/digest) |
| `packages/mcp` | MCP server exposing Listmonk operations |
| `packages/common` | Shared utilities, validation helpers, and atomic JSON persistence |

Runtime policy:
- Executable packages (`apps/cli`, `packages/mcp`) target the Bun runtime.
- Library packages are ESM. `openapi` and `operations` remain runtime-neutral; the file-backed APIs in `common`, `automation`, and `abtest` require a Node-compatible file-system runtime such as Bun.

## Prerequisites

- Bun 1.3+ (CI/build: 1.4.2)
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
- PostgreSQL: `localhost:15432` (Docker-internal `db:5432`)

Published ports bind to `127.0.0.1` by default because the local stack uses
fixed bootstrap credentials. Set `LISTMONK_BIND_ADDRESS` explicitly only when
you intend to expose Listmonk and Mailpit beyond the current machine. PostgreSQL
uses the separate `LISTMONK_DB_BIND_ADDRESS` and remains loopback-bound unless
that variable is explicitly changed.

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
# Optional: override the transactional idempotency store
export LISTMONK_OPS_TRANSACTIONAL_STORE="$HOME/.listmonk-ops/transactional.json"
# Optional: override the keyed resource-create idempotency store
export LISTMONK_OPS_RESOURCE_CREATE_STORE="$HOME/.listmonk-ops/ops/resource-creates.json"
# Optional: raise the store's soft record cap (bindings are durable replays
# with no automatic expiry; archive or rotate the store file when full)
# export LISTMONK_OPS_RESOURCE_CREATE_STORE_MAX_RECORDS=10000
# Optional: override the signed outbound-webhook endpoint/outbox store
export LISTMONK_OPS_WEBHOOK_STORE="$HOME/.listmonk-ops/outbound-webhooks.json"
# Optional alternative for multi-process/multi-worker webhook durability.
# Configure this OR LISTMONK_OPS_WEBHOOK_STORE, never both.
# export LISTMONK_OPS_WEBHOOK_DATABASE_URL="postgres://user:password@host/database"
# Optional: override the headless sequence definition/enrollment store
export LISTMONK_OPS_SEQUENCE_STORE="$HOME/.listmonk-ops/sequences.json"
# Optional alternative for multi-process/multi-worker sequence durability.
# Configure LISTMONK_OPS_SEQUENCE_DATABASE_URL OR LISTMONK_OPS_SEQUENCE_STORE, never both.
# export LISTMONK_OPS_SEQUENCE_DATABASE_URL="postgres://user:password@host/database"
# Optional: versioned provider profile JSON for read-only diagnostics
export LISTMONK_OPS_PROVIDER_CONFIG="$HOME/.listmonk-ops/providers.json"
```

You can create/manage tokens in the Listmonk admin UI.

### Declarative template provisioning

`@listmonk-ops/operations` exposes read-only planning and explicit apply helpers
for versioned template manifests. `reconcileTemplate()` and
`reconcileTemplateManifest()` plan by default; pass `{ apply: true }` or use
`ensureTemplate()` to mutate Listmonk. Exact-name duplicates fail closed, and a
complete manifest is planned before its first mutation.

The same contract is available through `listmonk-cli templates reconcile` and
the `listmonk_reconcile_template_manifest` MCP tool. Both default to a dry run,
cap manifests at 500 entries and 1 MiB of serialized payload, omit template
bodies from results, and require explicit confirmation. Apply from the CLI
with `--no-dry-run --confirm`.

Listmonk does not provide a multi-template transaction. If an apply fails after
earlier entries succeeded, `TemplateManifestApplyError` identifies the failed
template. Shared surface errors expose the completed entries as body-free
names, actions, and apply states for an explicit retry or rollback.
An omitted `body_source` is unmanaged because Listmonk preserves that field on
update; provide it when the manifest should enforce visual-template source.

After applying a manifest, `syncTemplateRegistry()` can capture the resulting
remote versions for promotion and rollback workflows. Keep release-time
template credentials separate from runtime delivery credentials. Before
promoting a transactional template, run the local Listmonk + Mailpit E2E suite.

### Least-privilege user roles

The enhanced client includes a handwritten `userRole` facade for Listmonk 6.2
role endpoints that are absent from its upstream OpenAPI document.
`reconcileUserRole()` and `reconcileUserRoleManifest()` plan by default;
`ensureUserRole()` or `{ apply: true }` performs the mutation. Permission names
are restricted to the Listmonk 6.2 vocabulary, exact-name duplicates fail
closed, and the reserved Super Admin role (ID 1) is never managed.

The same contract is available through `listmonk-cli user-roles reconcile` and
the `listmonk_reconcile_user_role_manifest` MCP tool. Both default to a dry run,
cap manifests at 500 roles and 1 MiB of serialized payload, omit role IDs and
permission values from results, and require explicit confirmation. Apply from
the CLI with `--no-dry-run --confirm`.

Listmonk does not provide a multi-role transaction. If an apply fails after
earlier entries succeeded, `UserRoleManifestApplyError` identifies the failed
role. Shared surface errors expose the completed entries as body-free names,
actions, and apply states for an explicit retry or rollback.

Two generic permission presets cover common separation-of-duty boundaries:
transactional subscriber delivery uses only `tx:send` and
`subscribers:manage`, while template provisioning uses only `templates:get`
and `templates:manage`. The credential running role reconciliation is a
separate control-plane credential and requires `roles:get` plus
`roles:manage`; do not grant those permissions to the runtime delivery role.

The runtime-neutral generated client under `@listmonk-ops/openapi/sdk` uses the
standard Fetch API and can be consumed from Workers-compatible runtimes;
file-backed registry automation remains a release/provisioning concern.
`@listmonk-ops/openapi/runtime` adds an opaque token-authenticated runtime handle
and a single-recipient external transactional helper for Worker request paths. The
transactional helper does not create subscribers, caps recipient addresses at 254 UTF-8 bytes and
subjects at 256 UTF-8 bytes, caps the successfully serialized transactional body
at 64 KiB, snapshots and bounds template data to 2,048 nodes and 32 nesting
levels, and projects remote failures to bounded errors. Callers can optionally
select an exact Listmonk messenger, rendered content type, plain-text
alternative, and a validated bare or display-name From address per message
without relying on the shared instance defaults. It rejects
sparse or extended arrays, callable/accessor serialization hooks, and HTTP
redirects before they can transform or replay a validated non-idempotent request.
Runtime base URLs also reject percent encoding, backslashes, and dot segments
before URL parsing; recipient domains use DNS-style labels with single-label
local domains retained for private Mailpit deployments.

For account-audience sync, `reconcileSubscriberMembership()` on the same runtime
entrypoint resolves an exact email, validates cached subscriber IDs, and reconciles
one explicitly application-owned list. It reports application eligibility/consent
separately from global blocklisting, membership status, and list opt-in mode.
Routine adds preserve concurrent unsubscriptions; deactivation unsubscribes without
deleting the suppression record. A later eligible job therefore cannot restore it:
explicit re-consent is a separate application workflow. Single opt-in permits an
unconfirmed membership; double opt-in remains pending and this helper never sends
an opt-in email. Unknown provider shapes fail closed with `provider_state_unknown`.
See the [runtime membership contract](packages/openapi/README.md#subscriber-membership-reconciliation)
for response bounds, errors, permissions, and caller-owned durable ordering,
email-change cleanup, account deletion, and restartable backfill.

The package root no longer exports the generated SDK as a `rawSdk` namespace,
because that namespace forced bundlers to retain every generated endpoint.
Raw SDK failures can lack `request` or `response`; guard them (for example,
`result.response?.status`) when inspecting transport errors.
Import individual generated functions from `@listmonk-ops/openapi/sdk` instead;
`createListmonkClient()` remains the ergonomic full-client entrypoint.

The A/B test, segment drift, and template registry stores use versioned JSON,
atomic replacement, and cross-process write locks so CLI and MCP processes can
share the same local state without losing concurrent updates. Invalid or newer
schemas are rejected instead of being overwritten.

Shared MCP operation audit events use the same atomic persistence mechanism.
They retain execution metadata only, never request inputs, outputs,
credentials, or remote error text.
Public automation results follow the same boundary: webhook delivery failures
are projected as bounded error codes, subscriber bulk/hygiene and template
registry failures omit remote error text (hygiene counts `failedSubscribers`
and summarizes each failed effect as `http_<status>`, `request_failed`, or
`negative_acknowledgement`), and hygiene samples omit subscriber IDs while
retaining masked email addresses.

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

## CLI Output Modes

The CLI supports a global `--format` flag that controls how output is
routed between stdout and stderr:

- `--format human` (default): human-readable messages and data on stdout.
- `--format json`: pretty-printed JSON data on stdout, human messages on stderr.
- `--format ndjson`: compact single-line JSON on stdout, human messages on stderr.
- `--format quiet`: data on stdout, all human messages suppressed.

```bash
listmonk-cli campaigns list --format json | jq .
listmonk-cli subscribers list --format ndjson
listmonk-cli ops guard --campaign-id 1 --format quiet --confirm
```

Machine-readable modes omit the CLI banner. Large JSON results, including the
full operation catalog, are drained to stdout before a normal CLI exit. Resource `list` commands emit an
array, including `[]` when no rows match; NDJSON writes each result as one JSON
line. Failures exit nonzero and emit a bounded `{ "error": { "code": "cli_error",
"message": "..." } }` diagnostic on stderr instead of runtime stack traces.
JSON mode buffers auxiliary diagnostics and emits them on completion in the
same stderr document under `diagnostics` (at most 20 messages of 1,024 characters).
NDJSON streams each bounded diagnostic immediately on stderr as
`{"diagnostic":{"level":"info","message":"..."}}`; parse that stream line by line.
Levels preserve success, info, warning, and error semantics. Error stacks and
arbitrary object details are omitted; quiet mode omits auxiliary diagnostics.
Long-running sequence/webhook workers accept NDJSON, human, or quiet mode and
reject buffered JSON mode. Keep stderr separate from stdout when parsing results.
Explicit help, version, and shell-completion requests retain their text formats.
Interactive prompts and `ops digest --markdown-only` require `--format human`.

### Shared connection profiles

CLI and MCP read the same versioned configuration file, defaulting to
`~/.listmonk-ops/config.json`. Create it with credential references rather than
secret values:

```json
{
  "schemaVersion": 1,
  "defaultProfile": "local",
  "profiles": {
    "local": {
      "baseUrl": "http://localhost:9000/api",
      "username": "api-admin",
      "tokenEnv": "LOCAL_LISTMONK_TOKEN"
    },
    "production": {
      "baseUrl": "https://newsletter.example.com/api",
      "username": "ops",
      "tokenFile": "tokens/production"
    }
  }
}
```

```bash
listmonk-cli --profile production config show --format json
listmonk-cli --profile production status --check --format json
listmonk-mcp --stdio --profile production
```

Use `--config /absolute/path/profiles.json` or `LISTMONK_OPS_CONFIG` for another
file. Profile selection is `--profile`, then `LISTMONK_OPS_PROFILE`, then the
file's `defaultProfile`. A selected profile supplies its own URL, username, and
credential reference: it does not inherit legacy `LISTMONK_API_URL`,
`LISTMONK_USERNAME`, `LISTMONK_API_TOKEN`, or `LISTMONK_PASSWORD` values.
Explicit `--listmonk-url`, `--listmonk-username`, and `--token-file` overrides
still apply. The MCP entrypoint also retains its inline token/password flags.
Without a selected profile, existing environment-based configuration and defaults
continue to work; `LISTMONK_API_TOKEN_FILE` takes precedence over an inline token.
Bun loads `.env` for both executables.

`config show` and MCP `listmonk_config` return the selected profile, available
profile names, field sources, credential reference, and default state directory.
They do not read or return token values. Relative `tokenFile` and `dataDirectory`
values in a profile resolve from the configuration file's directory; `--token-file`
resolves from the working directory, and a relative `LISTMONK_API_TOKEN_FILE`
resolves from the home directory. `~/` is supported. Use only one of `tokenEnv`
and `tokenFile` per profile. Token files must be regular UTF-8 files, at most
16 KiB, containing one nonempty token; a trailing newline is accepted. Keep token
files private, for example with mode `0600`.

Replace a token file atomically to rotate it. The next CLI command or MCP tool
call reads the new value; an in-flight command/tool call retains its credential
snapshot. Restart long-running workers to change their credential snapshot.
A missing or invalid replacement fails the next call instead of reusing a cached
token. Profile-file changes require a new CLI command or MCP process restart.

Profiles use separate default state directories under
`~/.listmonk-ops/profiles/<name>-<identity>/`; the identity includes the config
path, profile, target URL, and username, but not the token. Existing state is not
copied automatically. Set a profile's `dataDirectory` to use an explicit location.
Without a profile, `LISTMONK_OPS_DATA_DIR` selects the default state root, otherwise
`~/.listmonk-ops` remains the default. Explicit per-store environment paths and
Postgres runtime database settings retain precedence over these defaults; review
those overrides when switching environments.

## CLI Binary Install (GitHub Release + curl)

Prebuilt releases support Linux x64/arm64 and Apple silicon macOS (arm64).
Intel Macs are not supported.

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
MCP_HTTP_AUTH_TOKEN=<separate-random-bearer-token> \
MCP_HTTP_ALLOWED_HOSTS=mcp.example.com \
MCP_HTTP_ALLOWED_ORIGINS=https://mcp.example.com \
listmonk-mcp \
  --listmonk-url https://listmonk.example.com/api \
  --listmonk-username api-admin \
  --listmonk-api-token <token> \
  --host 0.0.0.0 \
  --port 3000
```

Use `listmonk-mcp --stdio` for command-based MCP clients. The default HTTP
runtime exposes the standard Streamable HTTP endpoint at `/mcp` while retaining
the legacy REST endpoints. Local HTTP keeps working without extra settings.
Non-loopback binding requires a separate MCP Bearer token plus explicit allowed
hosts and browser origins; MCP and tool requests must send that token in the
`Authorization` header. Use TLS at the reverse proxy when exposing HTTP.

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

After a PR is merged into `main` and its CI succeeds, workflow
`.github/workflows/sampo-release-publish.yml` runs:

1. With pending changesets, Sampo opens or refreshes the release PR with package
   versions, changelogs, and the regenerated Bun lockfile.
2. After that release PR is merged, the workflow builds, checks, and tests the
   workspaces before publishing npm packages through trusted publishing (OIDC).
3. Successful publishing creates tags and dispatches the separate native CLI
   release workflow. Native CLI contract tests also run on ordinary PRs.

The release action requires successful lockfile regeneration. Bun 1.4.2 is used
consistently for CI, publishing, and native CLI builds.

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
# Pass --idempotency-key so an ambiguous retry replays the same list.
listmonk-cli lists create --name "Product updates" --idempotency-key "launch-2026-08-product-updates"
listmonk-cli lists update --id 10 --name "Product updates" --confirm
listmonk-cli lists delete --id 10 --confirm
```

Campaign, subscriber, and template CRUD now use the same typed operations on
both surfaces. Uploaded media read/delete operations use the same contracts as
well. The CLI includes the full CRUD command set where Listmonk exposes it:

Campaign filters accept `--tags news,updates` (MCP: `tags: ["news", "updates"]`). The client sends repeated `tag` query parameters required by Listmonk 6.2; campaigns must contain all requested tags.

```bash
listmonk-cli campaigns list --page 1 --per-page 20
listmonk-cli campaigns create --name "Weekly update" --subject "News" \
  --from-email ops@example.com --body "<p>Hello</p>" \
  --template-id 1 --lists 10
# Pass --idempotency-key so an ambiguous retry replays the same campaign.
listmonk-cli campaigns create --name "Weekly update" --subject "News" \
  --from-email ops@example.com --body "<p>Hello</p>" \
  --template-id 1 --lists 10 --idempotency-key "newsletter-2026-08-weekly"
listmonk-cli campaigns update --id 42 --subject "Updated news"
listmonk-cli campaigns delete --id 42 --confirm
listmonk-cli campaigns schedule --id 42 --send-at 2026-08-01T09:00:00Z \
  --expected-updated-at <campaignUpdatedAt-from-preflight> --confirm
listmonk-cli campaigns start --id 42 --expected-updated-at <updated_at> --confirm
listmonk-cli campaigns pause --id 42 --expected-updated-at <updated_at>
listmonk-cli campaigns cancel --id 42 --expected-updated-at <updated_at> --confirm
listmonk-cli campaigns clone --id 42 --name "Copy of Weekly update"
listmonk-cli campaigns stats --id 42
listmonk-cli campaigns preview --id 42
# Recipients must be existing subscribers; each run sends a real message.
listmonk-cli campaigns test --id 42 --subscribers reviewer@example.com
listmonk-cli campaigns analytics --type views --from 2026-08-01 \
  --to 2026-08-31 --campaign-ids 42,43
listmonk-cli campaigns archive --id 42 --archive=true

listmonk-cli dashboard counts
listmonk-cli dashboard charts
listmonk-cli system about
listmonk-cli system logs --lines 50
# Credentials are recursively replaced by [redacted].
listmonk-cli settings get
# Every run sends a real message to the recipient.
listmonk-cli settings test-smtp --email reader@example.com \
  --host mailpit --port 1025
listmonk-cli system reload
# One-shot destructive collection: no server-side preview exists.
listmonk-cli maintenance gc-subscribers --type orphan --confirm
listmonk-cli maintenance gc-unconfirmed \
  --before-date 2026-01-01T00:00:00Z --confirm
listmonk-cli maintenance gc-analytics --type views \
  --before-date 2026-01-01T00:00:00Z --confirm

listmonk-cli subscribers create --email reader@example.com --name Reader
listmonk-cli subscribers update --id 7 --status enabled
listmonk-cli subscribers delete --id 7 --confirm
listmonk-cli subscribers add-to-lists --subscriber-ids 1,2,3 --list-ids 10,20
listmonk-cli subscribers remove-from-lists --subscriber-ids 1,2 --list-ids 10 --confirm
listmonk-cli subscribers blocklist --subscriber-ids 1,2,3 --confirm
listmonk-cli subscribers unblocklist --subscriber-ids 1,2

# Import a CSV asynchronously; poll progress; cancel if needed.
listmonk-cli subscribers import --mode subscribe --lists 1 \
  --file ./subscribers.csv --confirm
listmonk-cli subscribers export --id 7
# Every run sends a real opt-in message.
listmonk-cli subscribers send-optin --id 7
listmonk-cli subscribers import-status
listmonk-cli subscribers import-logs
listmonk-cli subscribers import-stop

listmonk-cli templates create --name "Campaign HTML" --body "<p>Hello</p>"
listmonk-cli templates update --id 3 --body "<p>Updated</p>"
listmonk-cli templates delete --id 3 --confirm
listmonk-cli templates set-default --id 3
listmonk-cli templates preview --id 3
listmonk-cli templates reconcile --manifest-file ./templates.json --confirm
listmonk-cli templates reconcile --manifest-file ./templates.json \
  --no-dry-run --confirm

listmonk-cli user-roles reconcile --manifest-file ./roles.json --confirm
listmonk-cli user-roles reconcile --manifest-file ./roles.json \
  --no-dry-run --confirm

listmonk-cli media list --page 1 --per-page 20
listmonk-cli media get --id 9
listmonk-cli media delete --id 9 --confirm
listmonk-cli media upload --file ./banner.png

listmonk-cli bounces list --page 1 --per-page 20
listmonk-cli bounces list --campaign-id 42 --source api \
  --order-by created_at --order desc
listmonk-cli bounces get --id 7
listmonk-cli bounces delete --id 7 --confirm
listmonk-cli bounces subscriber --subscriber-id 7
listmonk-cli bounces delete-subscriber --subscriber-id 7 --confirm

# Preview one bounded batch, then delete exactly the echoed ids.
listmonk-cli bounces prune --per-page 100 --confirm
listmonk-cli bounces prune --no-dry-run --bounce-ids 5,6,7 --confirm
```

Campaign lifecycle transitions are validated client-side against an
observed state machine (`draft → scheduled/running`, `scheduled →
running`, `running → paused/cancelled`, `paused → running`,
`finished`/`cancelled` are terminal). Subscriber
bulk operations chunk IDs (default 500 per chunk) and support
`--dry-run`, `--max-items`, and `--continue-on-error`. Media uploads
enforce a MIME allowlist and a 10 MiB size cap.

Bounce reads mirror the Listmonk `/api/bounces` filters (`--campaign-id`,
`--source`, `--order-by`, `--order`). Listmonk has no subscriber filter on
that endpoint, so the legacy `subscriber_id` argument — which never reached
the API — was dropped from the shared contract.

The corresponding MCP resource tools include
`listmonk_get_campaigns`, `listmonk_get_campaign`,
`listmonk_create_campaign`, `listmonk_update_campaign`,
`listmonk_delete_campaign`, the preview and test-send tools
`listmonk_preview_campaign` and `listmonk_test_campaign`, the equivalent
`subscriber` and `template` names,
and `listmonk_get_media`, `listmonk_get_media_file`, and
`listmonk_delete_media`. Their results include structured content while
retaining compatible legacy success text for destructive mutations.
The bounce read tools `listmonk_get_bounces` and `listmonk_get_bounce` and
the single-delete tool `listmonk_delete_bounce` keep their legacy names but
now project the same shared operations with structured content.
`bounces.delete` requires explicit confirmation, and Listmonk acknowledges
an already-deleted ID with the same success, so a retry is a documented
no-op verified through `bounces.list`.

`bounces.prune` replaces the legacy ungated bulk
`listmonk_delete_bounces` tool (explicit ids or `all=true`) with a
preview-then-echo contract: a dry run reports the exact bounce ids of its
bounded selection window (at most 100), and the destructive run echoes
that set as `bounce_ids`. Listmonk rejects a bulk delete naming any
missing ID, so the destructive run is issued as per-id deletes whose
missing-ID acknowledgement is the same success — an echoed repeat deletes
nothing new. Like the hygiene preview, the prune requires explicit
confirmation even for its dry run.

## Shared Operation Discovery

Use the credential-free catalog command to see the typed operations available
through both surfaces, including each operation's MCP name, input/output
schema, safety hints, and execution policy (`confirmationRequired`,
`auditRequired`, and `dryRunSupported`):

```bash
listmonk-cli operations
listmonk-cli operations --family campaigns
listmonk-cli specs search --query "schedule a reviewed campaign"
listmonk-cli specs describe --operation campaigns.schedule
listmonk-cli playbooks get --id campaign.safe-start
listmonk-cli playbooks get --id campaign.safe-schedule
listmonk-cli playbooks get --id template.safe-promote
listmonk-cli playbooks get --id abtest.safe-run
listmonk-cli capabilities
listmonk-cli prime --goal "schedule a reviewed campaign"
listmonk-cli status
```

MCP clients can call the read-only `listmonk_list_operations` tool with the
same optional `family` filter. The catalog intentionally covers shared typed
operations only; legacy transport-specific tools remain available separately.
Agents can use the corresponding `listmonk_schema_search`,
`listmonk_schema_describe`, `listmonk_list_playbooks`,
`listmonk_playbook_get`, `listmonk_capabilities`, `listmonk_prime`, and
`listmonk_status` tools. Search and prime results include typed-spec coverage,
effect-derived safety, execution requirements, and `useWhen`/`avoidWhen`
guidance. Status reports public connectivity/health, authentication, and selected
collection read access separately without returning credentials or remote error bodies.

```bash
listmonk-cli status --check --permissions lists,subscribers,campaigns --format json
```

`--check` exits with code 1 unless health, authentication, local catalog/spec checks,
and every requested collection read succeed. Without it, diagnostic failures remain
in the JSON result and the command exits normally. MCP `listmonk_status` accepts
`{"permissions":["lists","subscribers","campaigns"]}` and returns the same readiness
fields. Omit `permissions` to check health and authentication only. Each probe is a
read-only GET with a deadline of at most five seconds, no retries, and a 64 KiB response limit.
`not_checked` means credentials or a preceding authentication check are missing;
`unavailable` or `invalid_response` is inconclusive, never permission approval.
A successful collection check only verifies access to the visible collection: it
does not establish access to every subscriber/list, mutation rights, or send permission.
Public health alone no longer makes `readiness.listmonk` true. Target URLs omit
inline credentials, query strings, and fragments.

All 135 public shared operations now include a `spec` descriptor. Specs define
product resources and states, effects and derived safety, retry/reconciliation,
agent context, and typed playbooks independently of Listmonk endpoint shapes.
The maintenance boundary is:

```text
Listmonk OpenAPI -> handwritten adapter -> normalized shared executor -> spec
```

All 135 contracts are standalone TypeScript/Typia product contracts. The
existing 134 remain `stable`; `abtest.conversion.record` is experimental. The
stable set includes the bounce family (`bounces.list`, `bounces.get`,
`bounces.delete`, `bounces.prune`, `subscribers.bounces.get`,
`subscribers.bounces.delete`), the campaign preview, test-send, and
analytics operations (`campaigns.preview`, `campaigns.test`,
`campaigns.analytics`), the dashboard aggregate reads
(`dashboard.counts`, `dashboard.charts`), the subscriber import
lifecycle (`subscribers.import.start`, `subscribers.import.status`,
`subscribers.import.stop`, `subscribers.import.logs`), the template
preview read (`templates.preview`), the subscriber data-portability
export (`subscribers.export`), the system identity and diagnostics
reads (`system.about`, `system.logs`), the campaign archive toggle
(`campaigns.archive`), the opt-in resend
(`subscribers.send-optin`), and the credential-redacted settings read
(`settings.get`), the SMTP configuration test
(`settings.test-smtp`), the one-shot maintenance collections
(`maintenance.gc-subscribers`, `maintenance.gc-unconfirmed`,
`maintenance.gc-analytics`), and the
configuration reload (`system.reload`) joined the accepted stable
compatibility baseline after their observed Listmonk 6.2 response
shapes were verified against the local stack. The runtime-operation
bridge infrastructure is now empty — all operations have standalone
product-domain contracts. Upstream API changes are therefore absorbed at the
generated transport and handwritten adapter first; the product spec
changes only when the normalized operation contract or email-operation
meaning changes. Static governance rejects OpenAPI/generated SDK imports
from `src/specs`.

One hundred and four reviewed core operations are `stable`: the existing
`campaigns.get`, `campaigns.schedule`, `campaigns.start`, `campaigns.cancel`,
`subscribers.blocklist`, `transactional.send`, and
`ops.campaign.preflight`, plus the first read-only promotion batch:
`lists.list`, `lists.get`, `subscribers.list`, `subscribers.get`,
`campaigns.list`, `campaigns.stats`, `templates.list`, `templates.get`,
`media.list`, and `media.get`, and the static agent-discovery batch:
`specs.search`, `specs.describe`, `playbooks.list`, `playbooks.get`,
`control.capabilities`, and `control.prime`, plus the provider and
deliverability inspection batch: `providers.list`, `providers.status`,
`providers.test`, `providers.quota`, `providers.webhook-status`,
`deliverability.dns-check`, and `deliverability.doctor`. Their contracts and
policy semantics are checked against an accepted compatibility baseline.
Provider and deliverability operations are stable open-world reads: the
normalized output shape, redaction boundary, and retry semantics are stable,
but provider availability, quota values, DNS answers, and diagnostic outcomes
are observations rather than guarantees. Every diagnostic result is checked
fail-closed for credential references, AWS access keys, and forbidden secret
fields before it leaves the shared executor. Existing stable closed-world
control-plane reads include pure `sequences.validate` and aggregate-only
`sequences.status` and `webhooks.runtime.status`. This release newly promotes
the redacted `webhooks.list`, `webhooks.delivery.list`, and
`webhooks.dlq.list`, taking the stable baseline from 33 to 36 operations.
Webhook endpoint projections expose only the HTTPS origin, a deterministic
configuration fingerprint, and secret-reference presence. Delivery projections
expose subject and stored-error presence without returning their values.
This release also promotes the redacted `sequences.list`, `sequences.get`,
`sequences.enrollments.list`, and `sequences.enrollments.get` reads, taking the
stable baseline from 36 to 40 operations. Sequence revisions expose step counts,
step types, and deterministic content fingerprints without arbitrary step
payloads; enrollment reads expose subscriber-reference and stored-error
presence without their values.
`control.status` and `control.config` have stable typed contracts. Stable mutations also include `sequences.pause`,
`sequences.resume`, `webhooks.circuit.reset`, `templates.update`,
`templates.set-default`, and `templates.reconcile`. A follow-up batch
promoted the five read-only A/B test operations, `webhooks.update`,
`webhooks.inbound.ingest`, `ops.digest.daily`, and
`ops.templates.registry-history`. A second batch promoted the safe-retry
mutations `lists.update`, `subscribers.update`, `campaigns.update`,
`campaigns.pause`, `subscribers.add-to-lists`, `subscribers.unblocklist`,
and `ops.templates.registry-sync`. A third batch promoted `control.status`,
`subscribers.remove-from-lists`, and `ops.campaign.deliverability-guard`,
bringing the current stable baseline to 65 operations. A fourth batch
promoted the four idempotent delete operations (`lists.delete`,
`subscribers.delete`, `campaigns.delete`, `media.delete`) where retry on an
already-deleted resource is a documented no-op. A fifth batch promoted
`user-roles.reconcile`, whose plan-then-apply manifest convergence is
declared idempotent and previewable through dry-run. A sixth batch made
`webhooks.prune` destructive runs echo the exact delivery set and `before`
cutoff a dry run reported, so a retry deletes nothing new, and promoted
it. A seventh batch promoted the remaining deletes (`webhooks.delete`,
`sequences.delete`, `abtest.delete`, `templates.delete`) after making an
already-deleted resource a documented no-op that reports `deleted:
false`. An eighth batch promoted `abtest.launch` and `abtest.stop`,
whose repeats now return the persisted lifecycle state instead of
rescheduling delivery or repeating remote cleanup. A ninth batch promoted the purely local-store creates:
`webhooks.create` and `sequences.create` replay an identically
configured existing name as `created: false` (a conflicting
configuration still fails). A tenth batch made `abtest.create` commit
its replay intent (key, request fingerprint, and payload) before any
remote provisioning, so ambiguous retries resume the same test. A
follow-up checkpointed each provisioning phase, reconciles campaigns by
their deterministic `abtest:` tags on resume, stamps the assignment
seed and auto-launch window before their remote effects, adopts the
crashed attempt's tagged audience lists under the persisted seed, and
rolls back only confirmed deletions — closing the crash windows and
promoting the operation. An eleventh batch promoted `subscribers.create` — subscriber
emails are unique in Listmonk, so an ambiguous retry replays an
identically configured subscriber as `created: false` (verified
against the local stack). A twelfth batch promoted `ops.segments.drift` with
conditional retry semantics — an exactly identical keyed request
replays the period's committed measurement, unkeyed appends stay
unsafe. `webhooks.delivery.retry`
gained a pending no-op (`retried: false`) but stays experimental: a
dispatcher can complete the pending delivery first, so a repeat can
still start another delivery cycle. A thirteenth batch promoted
`sequences.update` with conditional retry semantics (a repeat whose
steps the latest revision already carries reports `updated: false`
without an equivalent revision; a superseded repeat appends and is
unsafe).
`sequences.enroll` gained conflict-replay machinery (an ambiguous retry
replays a provably untouched matching enrollment as `created: false`)
which kept it experimental at the time — once an enrollment reaches a
terminal status, the same request starts a fresh lifecycle — until the
thirty-first batch promoted it with a generation guard. A fourteenth batch gave `ops.templates.registry-rollback` an optional
`to_version_id` pin (a moved registry makes a pinned repeat conflict,
and an already-applied pin reports `rolled_back: false`) but it stays
experimental: ABA transitions and remote drift outside the registry are
indistinguishable without a source-version pin. A fifteenth batch gave `webhooks.test` keyed-probe
deduplication — a `correlation_id` derives a deterministic event id so
the outbox collapses an identical retry onto the queued delivery and
resumes or replays it (`replayed: true`) — which kept it experimental
at the time (a retry or expired lease whose first attempt reached the
endpoint redelivers the ping, the same at-least-once ambiguity as the
dispatch family) until the thirtieth batch promoted it with honest
reconcile semantics. A sixteenth batch applied the prune echo pattern to
`webhooks.dlq.replay`: destructive runs echo the exact dead-letter ids
a dry run reported (modeled as a discriminated contract union) and
already-requeued records are skipped in both stores — but it stays
experimental, because a worker can re-exhaust a replayed record before
the retry and make the identical echoed request eligible again. A
seventeenth batch gave `ops.subscribers.hygiene` echoed candidate sets
(CLI `--subscriber-ids`, required for destructive runs, enforced in the
exported workflow too) which kept it experimental at the time — a
subscriber that re-enters eligibility is re-selected by the identical
echoed request — until the thirty-second batch promoted it with an
updated_at generation guard.
A nineteenth batch gave `lists.create` a durable
`idempotency_key` (CLI `--idempotency-key`): the key is atomically claimed
in the file-backed resource-create store (configured with
`LISTMONK_OPS_RESOURCE_CREATE_STORE`) before the create is issued and then
bound to the created list id, namespaced by the Listmonk target. An
identical retry replays that list as `created: false`, a concurrent
same-key create waits for the in-flight one instead of issuing a second
POST, and conflicting payloads or targets under the same key are rejected
explicitly. A live same-host claim (verified past PID reuse) is never
stolen by age, and an attempt that ends ambiguously marks its claim
unknown so later same-key creates fail fast with reconciliation guidance
— the key is intentionally not reused, because no name-based check can
prove which same-named list a create produced (only an immutable uuid
correlates one). A keyed create requires
that store, so surfaces without one reject the key instead of silently
dropping the guarantee — promoting the operation with
testing-mode-independent conditional semantics (unkeyed creates stay
honestly unsafe because Listmonk list names are not unique). A twentieth
batch promoted `campaigns.create` with the same contract through a shared
keyed-create executor (CLI `--idempotency-key`, `{campaign, created}`
envelope, uuid correlation for id-less responses), a twenty-first promoted
`templates.create` the same way (template records carry no uuid, so
binding requires the id in the create response), a twenty-second promoted
`media.upload` with the payload hash taken over the filename, effective
MIME type, and the base64 content in its decoded-then-re-encoded
canonical form (so equivalent encodings, including pad-bit variants,
replay), and a twenty-third promoted `campaigns.clone` (the key binds
the source campaign and clone name; the unkeyed name-snapshot fallback
is never used for keyed clones). Twenty-fourth and twenty-fifth
batches promoted `sequences.tick` and `webhooks.tick` with the same
echoed-claim-set recovery contract, and a twenty-sixth promoted
`abtest.tick` (the echo carries each originally-due test's pre-tick
status, a retry re-attempts exactly that set, and a failed tick
surfaces its claim set as structured error details — winner
deployment is externally visible, so that recovery case still
classifies as reconcile): the output echoes the exact claimed
records with their originally claimed position (step for sequences,
attempt count for webhooks), and a retry carrying that echoed set as
`recovery_set` (CLI `--recovery-set`) runs a convergent position-bound
recovery pass over exactly those records — entries that already moved
on, hold a live lease, sit in backoff, or face an open circuit are
skipped (live ones reported as pending) — instead of claiming new due
work; a failed sequence tick surfaces the claim set on its error for
exactly this recovery. Webhook delivery stays honestly at least once in
every mode — the echoed set bounds a retry to the originally claimed
deliveries, but the POST itself can still duplicate an
accepted-but-unobserved attempt (the event-id header enables receiver
deduplication), so both webhook retry cases classify as reconcile. A
twenty-eighth batch promoted `webhooks.delivery.retry` and
`webhooks.dlq.replay` with generation-bound retries: the retry result
carries a dedicated `retry_generation` field — the count observed
BEFORE the request moved it — and a retry repeats by echoing THAT
field as `expected_manual_retry_count` (the `manual_retry_count` on
the returned `delivery` is already incremented; echoing it after a
worker cycle would pass the guard and start a second delivery cycle).
A repeat bound to the echoed generation only fires while the delivery
still sits at that generation — a worker cycle in between moves the
generation and the repeat reports the current state instead of
starting another delivery cycle; the dead-letter replay echoes each
candidate's generation and
replays only records still exhausted at it, closing the re-exhaustion
re-entry hazard. A
twenty-ninth batch promoted `abtest.run` (both revision guards —
expected_status and expected_updated_at — make an identical retry
converge, verified inside the store transaction), `abtest.deploy-winner`
(a retry adopts the single campaign tagged winner:deployed for the test
— validating its variant tag against the freshly analyzed winner,
rejecting ambiguous or multiple tagged campaigns, and finishing an
interrupted auto-launch before completing — instead of creating a
second holdout campaign), `webhooks.dispatch`
(the tick's attempt-bound recovery_set contract on the standalone
dispatch, capped at 100 entries like the dispatch limit), and
`ops.templates.registry-promote`/`-rollback` (promotion is conditional on
its `expected_remote_hash` pin — any intervening remote change, another
operator's promotion included, conflicts instead of being silently
overwritten, an already-current target is a `promoted: false` no-op that
issues no write or head advance, and an unpinned or forced retry keeps
the honest unsafe
classification; rollback accepts a
from_version_id source pin, an expected_head_revision pin over the
monotonic registry-head counter — every registry-managed write advances
it, a same-version re-promotion that restores drifted remote content
included, so an A → X → A cycle that restores both the version id
and the remote hash still conflicts — and an expected_remote_hash
out-of-registry drift pin, all checked inside the store lock. An
already-applied rollback is a no-op only when the remote actually
carries the target content — a target that drifted away while staying
active is repaired by re-promoting it instead. Listmonk
offers no conditional update, so the hash pins stay best-effort; a
successful promote or rollback changes the remote hash and advances the
head, so a pinned retry of the original request conflicts even after
its own success — that conflict is the documented reconciliation signal
to re-inspect, which is why both pinned cases classify as reconcile
instead of safe). A
thirty-second batch promoted `ops.subscribers.hygiene`, the last
experimental descriptor: the dry run now reports each selected
subscriber's raw `updated_at` observation as a `subscriberUpdatedAt`
array parallel to `subscriberIds`, and the destructive echo pairs them
in order as `subscriber_guards` (CLI `--subscriber-guards`). Listmonk advances `updated_at` when
the workflow blocklists (a list add leaves it unchanged, so an
already-present target membership is skipped structurally instead), so
the guard is the durable per-subscriber completion signal the spec's
graduation criterion asked for: a guarded destructive retry skips
everyone its own first attempt blocklisted and everyone whose profile
changed externally, while untouched members of the echoed set still
run. Because Listmonk offers no conditional mutation the guard is a
check-then-act read — the case classifies as reconcile with a
subscribers.list verification, a partially applied subscriber (list add
landed, blocklist failed) is counted in `failedSubscribers` and recovers
on a guarded retry or a fresh dry run while the already-present
membership is skipped structurally, and a missing updated_at fails the
run instead of fabricating a token. Dry runs stay
trivially safe, and a destructive run without guards keeps the honest
unsafe classification. A
thirty-first batch promoted `sequences.enroll` with a generation
guard: the caller echoes the number of enrollments (any status) that
already existed for the sequence and subscriber — observed via
`sequences.enrollments.list` — as `expected_prior_enrollments`, and the
create verifies the count inside the store transaction so concurrent
guarded retries cannot double-create. A guarded ambiguous retry then
converges across the whole lifecycle: it creates only while the count
still matches, replays the single landed enrollment as `created:
false` even after it reached a terminal status (the exact hazard that
kept the operation experimental — an unguarded repeat restarts a
terminal lifecycle), and conflicts when more than one landed or the
landed enrollment carries a different context. Intentional
re-enrollment stays explicit: a request without the guard still starts
a fresh lifecycle after a terminal enrollment. A
thirtieth batch promoted `webhooks.test`: the keyed probe's event id
derivation is now an HMAC over a server-generated high-entropy probe id
key persisted with the webhook store — the file store or the Postgres
runtime meta table — giving key separation from every endpoint signing
credential: probe identity is decoupled from the signing secret, and a
low-entropy signing secret cannot be brute-forced from known probe
message/id pairs. The derivation stays bound to the
configuration revision so a repeat after a URL or secret change still
tests the new configuration, and a keyed probe fails fast when the
signing secret is unavailable or blank. A keyed retry still collapses
onto the queued delivery, but the delivery itself is honestly
at-least-once — the keyed case
classifies as reconcile, verified through `webhooks.delivery.list` with
the event-id header enabling receiver deduplication — while an unkeyed
probe sends a fresh ping on every attempt and stays unsafe. A
twenty-seventh batch promoted all three reconcile operations
(`sequences.reconcile`, `webhooks.reconcile`, `abtest.reconcile`) with
echoed-scanned-set recovery: each scan echoes the exact ids it
considered (`scanned_ids`), and a retry carrying that echo as
`recovery_set` re-examines exactly that batch — leases already
recovered are no longer expired and drift already repaired no longer
matches, so the retry converges instead of selecting the next backlog
batch. The sequences ambiguous-send resolution mode is independently
convergent (it requires the enrollment to still be ambiguous).

The spec publishes seven typed playbooks: `campaign.safe-start`,
`campaign.safe-schedule`, `template.safe-promote`, `abtest.safe-run`,
`campaign.deliverability-guard`, `provider.health-check`, and
`webhook.retention`.
Every public shared operation binds a descriptor, and the migration exemption
manifest is empty. Coverage rejects missing, dangling, overlapping, or
mismatched declarations.

Operations Spec artifacts are checked in under
`packages/operations/generated/specs`. Run `bun run operations:specs:generate`
after changing a contract or descriptor; `bun run check` rejects generated
drift and verifies that every described operation remains connected to its
named operation invoker and executor in the compiler graph. `bun run build`
also verifies all 128 shared operations, the API boundary rule, the 0
runtime bridges, the 128 stable compatibility baselines, and 389 direct
spec-to-runtime graph edges.

All 128 shared operations now use standalone TypeScript contracts. There are
no governed runtime-bridge inputs or snapshots to regenerate.

The spec API is published from the existing operations package through the
`@listmonk-ops/operations/specs` subpath; it is not a separate npm package.

For a destructive shared MCP operation, include the MCP-only
`"confirm": true` input. The adapter removes that control before invoking the
typed domain operation. A `dry_run: true` request is accepted only when the
cataloged operation explicitly supports a real dry run; unsupported dry-run
requests are rejected instead of being simulated. Mutating shared MCP
operations append `started`, `blocked`, `succeeded`, or `failed` metadata-only
events to `<resolved-data-directory>/operation-audit.json` by default. The staged
migration deliberately leaves legacy transport-specific MCP tools unchanged,
except for `listmonk_update_campaign_status`, which was removed because it
bypassed the server-level audit store and confirmation gate. Use the shared
lifecycle operations instead: `listmonk_schedule_campaign` (with `send_at`),
`listmonk_start_campaign`, `listmonk_pause_campaign`, and
`listmonk_cancel_campaign`.

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
surfaces accept the same recipient, template data, content type, messenger,
subject override, plain-text alternative, and custom header payloads:

```bash
listmonk-cli tx send \
  --template-id 42 \
  --subscriber-email recipient@example.com \
  --from-email "Ops <ops@example.com>" \
  --content-type html \
  --messenger email \
  --subject "Welcome, {{ .Subscriber.Name }}" \
  --altbody "Welcome to the service." \
  --data '{"name":"Ada"}' \
  --headers '[{"X-Trace-ID":"example-trace"}]'
```

The email or ID selector targets an existing Listmonk subscriber.
Sender overrides must resolve to one well-formed bare or display-name mailbox;
the same validation is applied to stored sequence send steps before dispatch.
Legacy version 1 sequence stores remain readable; an invalid stored sender is
quarantined as a failed enrollment before Listmonk is called.
Custom headers are limited to application metadata. Message identity,
authentication results and signatures, routing and delivery trace metadata,
and all `ARC-*` and `Resent-*` headers remain owned by Listmonk and the SMTP
transport and are rejected before dispatch.

The corresponding MCP tool is `listmonk_send_transactional`. It returns
structured content like `{"sent": true, "status": "accepted"}` and keeps the
legacy boolean text result for existing clients.

### Idempotent transactional sends

Listmonk's `/api/tx` endpoint acknowledges a send with only a boolean, so a
client that times out and retries cannot tell whether the message already left.
Supply an `idempotency_key` to make retries safe:

```bash
listmonk-cli tx send \
  --template-id 42 \
  --subscriber-email recipient@example.com \
  --idempotency-key "$(uuidgen)"
```

The wrapper:

- Persists a `pending` record keyed on `idempotency_key` before dispatch.
- Replays the stored result on an identical retry (`status: "replayed"`,
  `duplicate: true`) instead of re-sending.
- Rejects a different payload under the same key as a conflict.
- Reserves the `sequence:` key prefix for sequence workers; direct sends must
  choose another idempotency key.
- Records an ambiguous transport failure (timeout, connection reset) as
  `unknown` and blocks automatic retry — inspect Listmonk and the idempotency
  record, then reconcile manually. `pending` and `unknown` records remain
  blocked after their TTL; time alone never permits a second delivery.

Inspect records for the selected Listmonk target with `listmonk-cli tx records
--status unknown --format json` or MCP `listmonk_transactional_records`.
These responses contain metadata, including an opaque `revision`, but no
recipient, message body, or raw transport error.
Use the returned `next_cursor` with `tx records --cursor CURSOR` (or the MCP
`cursor` input) to inspect every page. These local commands remain available
when the API token file is unavailable; `--interactive` can select the same
target that an earlier interactive send used.
Check Listmonk, the delivery provider, or local Mailpit independently before
deciding. To record verified delivery, run:

```bash
listmonk-cli tx reconcile --key ORDER_KEY --expected-revision REVISION \
  --decision accepted --reason "Verified delivery in provider logs" --confirm
```

If delivery definitely did not occur, choose `--decision retry` instead. This
only removes the blocking claim; it does not send mail. The next explicit send
with the same key can dispatch. A retry decision requires its TTL to have
passed and `--quiesced` after the sender has stopped. A verified `accepted`
decision does not wait for TTL because it cannot dispatch mail. The MCP equivalent is
`listmonk_reconcile_transactional` with `confirm: true`. Both surfaces require
the observed revision and a 10–500 character reason; the store atomically
checks the target and revision. It retains the latest decision for each sequence
claim so delayed enrollment recovery remains possible, while bounding direct-send history. Never
approve retry while an earlier sender may still be active.
When `LISTMONK_OPS_SEQUENCE_DATABASE_URL` is set, direct transactional sends,
inspection, and reconciliation use the sequence PostgreSQL claim store. The
version 3 schema migration preserves existing claims.

Without a sequence database, the store path defaults to
`<resolved-data-directory>/transactional.json`; override it with
`LISTMONK_OPS_TRANSACTIONAL_STORE`. Inspection may create or migrate this
store. Version 1 files migrate to version 2 on the next store access; older binaries reject version 2 instead of
silently discarding unresolved claims or decision history.

## A/B Test Operations

CLI `abtest` group now supports full lifecycle operations:

```bash
listmonk-cli abtest list
listmonk-cli abtest get --test-id <id>
listmonk-cli abtest create ... --confirm
listmonk-cli abtest launch --test-id <id> --confirm
listmonk-cli abtest stop --test-id <id> --confirm
listmonk-cli abtest analyze --test-id <id>
listmonk-cli abtest record-conversion \
  --event-id order-123 --test-id <id> --variant-id <variant-id> \
  --subscriber-uuid <uuid> --event purchase --value 25 --currency USD \
  --occurred-at 2026-09-23T12:00:00Z --confirm
listmonk-cli abtest recommend-sample-size \
  --lists 123,456 --test-group-percentage 10 --variant-count 2
listmonk-cli abtest deploy-winner --test-id <id> --confirm
listmonk-cli abtest delete --test-id <id> --confirm
listmonk-cli abtest run --test-id <id> \
  --expected-status <status-from-get> \
  --expected-updated-at <updatedAt-from-get> --confirm
listmonk-cli abtest tick --dry-run true --confirm
listmonk-cli abtest tick --confirm
listmonk-cli abtest reconcile --test-id <id>
listmonk-cli abtest reconcile --all --repair --confirm
```

Creating with `--auto-launch true` starts the backing campaigns immediately;
review that flag as a sending operation before using it in automation.

`abtest tick` advances every non-terminal test one lifecycle step (for
cron/systemd timers). Use `--dry-run true` to preview without mutating.
`abtest run` progresses a single test. Copy `status` and `updatedAt` from the
preceding `abtest get` result into its revision options so an intervening tick
cannot invalidate the approved state silently. `abtest reconcile` reports
local drift and can repair with `--repair --confirm`.

`record-conversion` accepts events only after launch, through the test end plus
the pre-registered attribution window (or the test's end time when no window is
registered; 72 hours after launch if neither is set), and only while that
deadline has not passed at recording time, and
for a subscriber still verifiable in the provisioned variant list. The event
ID is globally unique in the local store: identical retries return
`duplicate`, while a changed payload with the same ID is rejected. CLI and MCP
share the transactional `abtest-conversions.sqlite` store in the Listmonk data directory;
set `LISTMONK_OPS_ABTEST_CONVERSION_STORE` to override its path. The store keeps
UUIDs, event names, timestamps, and optional value/currency, without emails or
names. Analysis counts unique converting subscribers per variant and sums
event values as revenue. Keep the variant lists available until the attribution
window closes so new events can be verified. Recording is append-only, so CLI
requires `--confirm` and MCP requires `confirm: true` for each event. Automated
`abtest run` and `abtest tick` wait for that attribution tail before analyzing
or deploying a winner.

MCP now also exposes A/B test lifecycle tools:

```text
listmonk_abtest_list
listmonk_abtest_get
listmonk_abtest_create
listmonk_abtest_analyze
listmonk_abtest_conversion_record
listmonk_abtest_launch
listmonk_abtest_stop
listmonk_abtest_delete
listmonk_abtest_recommend_sample_size
listmonk_abtest_deploy_winner
listmonk_abtest_run
listmonk_abtest_tick
listmonk_abtest_reconcile
```

### A/B test correctness hardening

The A/B test domain fixed several correctness issues that could distort
send results. Summary of the current behavior:

- **Exact allocation**: test/holdout and per-variant sizes are computed with
  the largest-remainder method so they always sum to the audience total.
  The previous `Math.floor` equal split ignored variant percentages and
  dropped leftover recipients.
- **Paginated audience resolution**: each source list is paginated with the
  `list_id` server filter, deduplicated by UUID, and filtered to
  `status === "enabled"`. This replaces summing `subscriber_count` (which
  double-counted) and the `per_page: "all"` fetch-then-client-filter.
- **Fail-closed metrics**: a Listmonk fetch failure throws
  `AbTestMetricsUnavailableError` instead of falling back to `Math.random()`
  mock data. Clicks are no longer copied into conversions.
- **Status-aware cleanup**: stop/cleanup branches on each campaign's actual
  status. Listmonk v6.2.0 only allows cancelling `running` campaigns, so
  `draft`/`scheduled` campaigns are deleted instead. Campaign names are
  preserved. Temporary lists are retained as long as any campaign still
  references them (unobservable, preserved-terminal, or failed-delete
  campaigns); 404 responses are treated as idempotent success.
- **Confidence threshold honored**: the stored `confidenceThreshold` drives
  alpha so the significance decision and reported confidence level match.
- **Statistical hardening**: Holm-Bonferroni correction for A/B/C (3+
  variant) tests, fixed-horizon eligibility gate (endsAt, minimum
  duration, minimum sample per variant), and SRM (Sample Ratio
  Mismatch) detection via chi-square goodness-of-fit. When the gate
  fails or SRM is detected, `isSignificant` is suppressed and no winner
  is declared. The `analyze` output includes `correctedPValue`,
  `holmCorrected`, `srmPassed`, `srmPValue`, and
  `fixedHorizonReasonCodes` fields for operator diagnostics.

See [`packages/abtest/README.md`](packages/abtest/README.md) for the
underlying Listmonk API behavior and spike rationale.

### Hypothesis pre-registration and recipient-domain stratification

`abtest create` accepts two advanced experimentation inputs:

- `--hypothesis '{...}'` — a pre-registration hypothesis (objective, primary
  metric, expected lift, owner, experiment scope). The service locks it
  (SHA-256 checksum) before recipient assignment so the metadata cannot
  change after recipients are set.
- `--enable-stratification` — classify subscribers by email-domain provider
  and apply a constrained quota matrix so each provider stratum gets a
  proportional share of every variant/holdout group. The actual recipient
  slices realize the stored quota matrix: within each stratum members are
  ranked by the same deterministic digest ordering and each group consumes
  its quota cell, so test/holdout and per-variant totals still come from
  the largest-remainder manifest and the assignment stays reproducible
  under the persisted seed. When any resolved subscriber lacks an email,
  or the quota solver fails, provisioning falls back to the unstratified
  manifest assignment with an undefined stratification.

```bash
listmonk-cli abtest create \
  --name "Subject Line Test" \
  --campaign-id 1 \
  --variants '[...]' --lists 1,2 \
  --enable-stratification \
  --hypothesis '{"objective":"Increase CTR","hypothesis":"Shorter subject lifts CTR","primary_metric":{"type":"click_rate","direction":"maximize"},"expected_lift":{"kind":"relative","value":0.1},"owner":{"id":"user-1"},"experiment_scope":{"channel":"email","experiment_family_key":"onboarding.welcome","attribution_window_hours":72,"exclusion_window_hours":168}}'
```

See [`packages/abtest/README.md`](packages/abtest/README.md) for the full
validation rules, the stratified quota solver, and bilingual (EN/KO)
guidance.

### Hypothesis-driven analysis

When a test carries a pre-registered hypothesis, `abtest analyze` uses the
declared primary metric (`click_rate`, `conversion_rate`) and direction
(`maximize`/`minimize`) to drive winner selection — not the observed-data
heuristic. Reports include the hypothesis objective, expected lift, and a
pre-registration status (`verified`/`not_available`/`checksum_mismatch`).
Tests with a checksum-mismatched hypothesis are rejected before analysis.

When revenue data is present, the report includes `Revenue` and
`Rev/Recipient` columns with an optional currency suffix (e.g.
`Revenue (USD)`). A `revenue_per_recipient` primary metric always shows
these columns even before metrics are collected.

### Preview and seed send gate

The preview gate requires content preview checks and optional seed sends
before launch. Content changes invalidate prior approvals. See
[`packages/abtest/README.md`](packages/abtest/README.md) for the full API.

### Experiment collision guard

The collision guard prevents overlapping experiments in the same family
from exposing the same subscribers. It uses an installation-level HMAC key
(`LISTMONK_OPS_COLLISION_KEY`) to derive stable cross-test subject keys and
an atomic check-and-reserve participation store.

**Multi-node note:** `InMemoryExperimentParticipationStore` is suitable for
single-node deployments and tests. In a multi-node deployment (multiple CLI
or MCP processes), every process gets its own in-memory store, so collision
checks are not shared across nodes. For multi-node production, implement a
shared `ExperimentParticipationStore` (e.g. backed by Postgres with an
exclusion constraint on `(subject_key, family_key, active_window)`).

See [`packages/abtest/README.md`](packages/abtest/README.md) for the full
API, policies, and bilingual guidance.

## Ops Automation Commands

```bash
# 1) Pre-send gate
listmonk-cli ops preflight --campaign-id 123 --check-links true --fail-on-warn false

# 2) Deliverability guard
listmonk-cli ops guard --campaign-id 123 --pause-on-breach true --confirm
# Engagement breaches (open/click rate) require a minimum of 100 sends
# before they are evaluated. Override with --minimum-sent.

# 3) Subscriber hygiene (preview)
listmonk-cli ops hygiene --mode winback --dry-run true --inactivity-days 90 --confirm
# Echo --subscriber-ids from the dry run for the destructive execution.
# "Inactive" means the profile's updated_at is old, not that the reader
# stopped opening or clicking; sunset blocklisting cannot be undone for
# list subscriptions (see below).

# 4) Segment drift snapshot
listmonk-cli ops segment-drift --threshold 0.2 --min-absolute-change 50
# Use --baseline-mode lookback-mean to compare against the lookback
# window average instead of the previous snapshot. Pass a stable
# --sample-key (for example the UTC date) so an identical retry
# replays that period's committed measurement instead of appending
# a duplicate sample.

# 5) Template registry/versioning
listmonk-cli ops templates-sync
listmonk-cli ops templates-history --template-id 10
listmonk-cli ops templates-promote --template-id 10 --version-id v_... --confirm
listmonk-cli ops templates-rollback --template-id 10 --confirm
# Pin the target with --to-version-id so an ambiguous retry replays or
# fails explicitly instead of rolling to a different version.

# 6) Daily digest
listmonk-cli ops digest --hours 24 --output /tmp/listmonk-ops-digest.md
```

`ops hygiene` selects enabled subscribers whose profile `updated_at` is older
than `--inactivity-days`. Listmonk advances `updated_at` only on profile edits
and API blocklisting — sends, opens, clicks, opt-in confirmations,
unsubscribes, and list additions leave it untouched — so the threshold
measures how long nobody modified a profile, not how long a reader has been
disengaged: an engaged reader whose profile was never edited is selected too.
A candidate must also still hold a membership Listmonk would deliver to (not
unsubscribed, and confirmed on a double opt-in list; with `--source-list-ids`,
on one of those lists), so a subscriber who unsubscribed everywhere is never
added to a winback list. Opt-in modes come from the list endpoint, and
unconfirmed memberships on lists the token cannot read fail closed. Winback
adds candidates to `--target-list-id` as unconfirmed members, which a single
opt-in list delivers to. **Sunset blocklisting is irreversible for list
subscriptions:** Listmonk marks every membership unsubscribed, and removing the
blocklist does not restore them. Destructive results report
`processedSubscribers` (every mutation acknowledged by Listmonk) and
`failedSubscribers` (error responses or missing acknowledgements, including a
subscriber whose list add landed before its blocklist failed).

Preflight link checking now blocks private/internal hosts (loopback,
private CIDRs, link-local, cloud metadata IPs) and follows redirects
manually with per-hop revalidation. Template promote supports
optimistic concurrency via `--expected-remote-hash`. MCP/CLI operation outputs
no longer expose absolute filesystem paths.

## Signed Outbound Event Webhooks

CLI and MCP share a versioned event envelope, endpoint registry, and durable
outbox. Endpoint records contain only a `secret_ref`; the HMAC secret itself is
resolved from that environment variable at delivery time and is never written
to the store.

```bash
export LISTMONK_OPS_WEBHOOK_SECRET="<random-secret>"

listmonk-cli webhooks create \
  --name operations \
  --url https://events.example.com/listmonk \
  --secret-ref LISTMONK_OPS_WEBHOOK_SECRET \
  --event-filters 'operation.*,campaign.*,abtest.*' \
  --circuit-failure-threshold 5 \
  --circuit-cooldown-ms 300000

listmonk-cli webhooks test --id <endpoint-uuid> --confirm
listmonk-cli webhooks tick --dispatch-limit 25 --confirm
listmonk-cli webhooks reconcile
listmonk-cli webhooks reconcile --no-dry-run
listmonk-cli webhooks prune --older-than-days 30 --dry-run
listmonk-cli webhooks prune --before <cutoff> --ids <ids-from-dry-run> --no-dry-run --confirm
listmonk-cli webhooks deliveries list --status exhausted
listmonk-cli webhooks deliveries retry --id <delivery-uuid> --confirm
listmonk-cli webhooks runtime status
listmonk-cli webhooks runtime worker --interval-ms 5000 --confirm
listmonk-cli webhooks dlq list
listmonk-cli webhooks dlq replay --dry-run
listmonk-cli webhooks dlq replay --delivery-ids <ids-from-dry-run> --no-dry-run --confirm
listmonk-cli webhooks circuit reset --id <endpoint-uuid> --confirm
listmonk-cli webhooks inbound ingest \
  --provider ses \
  --provider-event-id <stable-provider-event-id> \
  --kind bounced \
  --message-id <provider-message-id>
```

Filters accept an exact event type, a family wildcard such as `campaign.*`, or
`*`. Initial contracts cover operation, campaign, subscriber, delivery, A/B
test, sequence, and test events. Payload fields with credential or personal-data names
are recursively redacted before persistence.
Audited CLI and MCP operations automatically enqueue `operation.started`,
`operation.blocked`, `operation.succeeded`, and `operation.failed` with the
same execution ID. Event projection is best-effort after the durable audit
write, so an unavailable webhook store cannot replace an operation result or
invite an unsafe retry. A targeted `webhooks test` diagnostic bypasses the
endpoint's normal event filters without changing them.
Successful campaign schedule/start/pause/cancel operations, subscriber
create/update/blocklist operations, A/B lifecycle operations, and sequence
definition/enrollment controls also project typed domain events from the same
CLI/MCP execution boundary. Subscriber
payloads contain resource IDs or a batch checksum and counts, never addresses.

Each request includes `X-Listmonk-Ops-Event-Id`,
`X-Listmonk-Ops-Event-Type`, `X-Listmonk-Ops-Timestamp`, and
`X-Listmonk-Ops-Signature: v1=<hex>`. Verify the signature over
`<timestamp>.<exact-body>` and reject timestamps outside the receiver's replay
window (five minutes is the provided verifier default). Delivery is
at-least-once with a stable event ID, exponential backoff, delivery history,
terminal `exhausted` state, and confirmed manual retry.
If another worker reclaims an expired lease, the original dispatch reports
that attempt as `skipped` while preserving sibling results; inspect the shared
delivery log for the final state.

`exhausted` records form the dead-letter queue. Replay defaults to a dry run,
and circuit breakers pause endpoint claims after repeated failures until their
cooldown expires or an operator resets them. `webhooks runtime status` reports
schema, backlog, circuit, DLQ, and running, stale, stopped, or failed worker
health. Verified provider
adapters can ingest delivered, bounced, complained, unsubscribed, delayed, and
rejected events into the same envelope; stable provider event IDs make
ingestion idempotent and sensitive metadata keys are redacted. Unsubscribe
events require a subscriber UUID, and provider metadata is capped at 16 KiB.

The JSON store remains the zero-configuration single-host default. Existing v1
files are read compatibly and persisted as v2 on the next mutation. For
multiple CLI/MCP/worker processes, set `LISTMONK_OPS_WEBHOOK_DATABASE_URL`
instead. The Postgres repository uses normalized endpoint and delivery tables,
transactional enqueue deduplication, `FOR UPDATE SKIP LOCKED` claims, and
lease-token fencing. Ordered, advisory-lock-protected migrations upgrade the
runtime schema. `webhooks tick` first reconciles expired leases and then
dispatches a bounded batch. `webhooks reconcile` previews recovery by default
and applies it with `--no-dry-run`. Reconciliation is bounded by a per-call
limit, so an ambiguous retry can process the next batch of expired deliveries
rather than being a pure no-op; re-run in dry-run mode to verify the remaining
backlog before retrying. In contrast,
`webhooks prune` defaults to a dry run. Destructive runs echo the exact
delivery ids and `--before` cutoff the dry run reported, so a confirmed
deletion can never drift with the clock and a retry deletes nothing new.

Only public HTTPS endpoints without credentials, query strings, or fragments
are accepted. Destination DNS/IP safety is rechecked against globally routable
address ranges when dispatching, each validated address is tried in order and
pinned for its HTTPS connection, and redirects are disabled. Use `webhooks
tick` from a scheduler or run the heartbeat-tracked
`webhooks runtime worker --confirm` process under a service manager. Endpoint
management alone does not start a background daemon. The worker retries
transient tick failures with bounded exponential backoff before failing for
its process supervisor to restart. See the
[production worker deployment guide](docs/worker-deployment.md) for systemd,
Docker Compose, persistence, and recovery examples for both worker types.

## Headless Email Sequences

Sequences are typed, revisioned workflows shared by the CLI and MCP server.
Each enrollment is pinned to the revision that existed when it was created, so
later edits do not mutate running subscriber journeys. The MVP supports
`send`, `wait`, absolute `wait_until`, `condition`, and `stop` steps.
Send steps can pin the messenger and sender, override the subject and content
type, and supply a multipart plain-text alternative; all delivery options are
part of the deterministic idempotency payload.

```bash
listmonk-cli sequences validate \
  --steps '[{"id":"welcome","type":"send","template_id":12},{"id":"delay","type":"wait","duration_seconds":86400},{"id":"stop","type":"stop"}]'

listmonk-cli sequences create \
  --name welcome \
  --steps '[{"id":"welcome","type":"send","template_id":12},{"id":"delay","type":"wait","duration_seconds":86400},{"id":"stop","type":"stop"}]'

listmonk-cli sequences enroll \
  --id <sequence-uuid> \
  --subscriber-id 42 \
  --context '{"plan":"pro"}'

listmonk-cli sequences enrollments list --status ambiguous
listmonk-cli sequences enrollments get --id <enrollment-uuid>
listmonk-cli sequences status
listmonk-cli sequences tick --limit 25 --confirm
listmonk-cli sequences reconcile --dry-run --confirm
listmonk-cli sequences reconcile --no-dry-run --confirm
listmonk-cli sequences worker --interval-ms 5000 --confirm
```

Before every `send`, the worker reloads the subscriber and cancels delivery
when the subscriber is blocklisted, disabled, or unsubscribed from every
returned list. Transactional sends use a deterministic enrollment/revision/step
idempotency key. Definitive pre-dispatch failures retry with jittered, bounded
exponential backoff for at most 24 attempts, exposed as `retry_count` on
enrollment list/get output.
A response-lost send becomes `ambiguous` and is never retried automatically;
after checking Listmonk/Mailpit/provider evidence, resolve it explicitly with
`sequences reconcile --enrollment-id ... --resolution sent` or `not_sent`,
plus `--no-dry-run --confirm`. A still-`pending` send claim cannot be resolved
through `sequences reconcile` while delivery may remain in flight. For a
stranded claim, inspect it with `tx records`, verify delivery independently,
and use `tx reconcile` with its observed revision. Then resolve the enrollment
as `sent` after an `accepted` decision, or as `not_sent` after a TTL-expired,
quiesced `retry` decision.
Repeated `pending` replays move the enrollment to `ambiguous` before the
retry limit would make it terminal; a verified `accepted` sequence claim is
retained until enrollment recovery, preventing a resumed worker from sending again.

The default file store is `~/.listmonk-ops/sequences.json`. Set
`LISTMONK_OPS_SEQUENCE_DATABASE_URL` for concurrent workers; Postgres uses
`FOR UPDATE SKIP LOCKED`, lease-token fencing, and advisory-lock-protected
schema initialization. It also stores transactional idempotency claims in the
same database so every worker observes one shared send decision.
`sequences status` reports due work, ambiguity, leases,
and running/stale/stopped/failed worker health. Old worker records are pruned
after the retention window. Sequence create/revise/enroll/pause/resume and
operator reconciliation also project typed `sequence.*` outbound events.

## Provider and Deliverability Doctor

Provider profiles describe the expected delivery setup without storing raw
credentials. The SES integration uses the standard AWS credential chain or a
named local AWS profile, performs read-only account and identity calls, and
never sends a message.

```json
{
  "schema_version": 1,
  "profiles": [
    {
      "id": "marketing-primary",
      "kind": "ses",
      "messenger": "email",
      "sending_domain": "news.example.com",
      "from_email": "newsletter@news.example.com",
      "smtp_hosts": ["email-smtp.ap-northeast-2.amazonaws.com"],
      "smtp_username_fingerprints": [
        "sha256:<sha256-of-the-listmonk-smtp-username>"
      ],
      "mail_from_domain": "bounce.news.example.com",
      "region": "ap-northeast-2",
      "secret_ref": "aws:default",
      "webhook_source": "ses",
      "webhook_max_age_hours": 168
    }
  ]
}
```

`secret_ref` accepts only `aws:default` or `aws:profile:<name>` for SES. The
profile list, audit events, CLI output, and MCP results never include the
reference or resolved credentials.
SES profiles also require a SHA-256 fingerprint for every distinct SMTP
username used by the enabled Listmonk pool. Generate one without writing the
username to the provider config:

```bash
printf '%s' "$LISTMONK_SMTP_USERNAME" | shasum -a 256
```

Store the result as `sha256:<hex>` in `smtp_username_fingerprints`; the raw
username and the configured fingerprints are never returned by the doctor.

```bash
listmonk-cli providers list
listmonk-cli providers status --provider-id marketing-primary
listmonk-cli providers test --provider-id marketing-primary
listmonk-cli providers quota --provider-id marketing-primary
listmonk-cli providers webhook-status --provider-id marketing-primary
listmonk-cli deliverability dns-check --provider-id marketing-primary
listmonk-cli deliverability doctor --provider-id marketing-primary
```

The doctor composes Listmonk messenger and bounce settings, SES account quota
and identity state, DMARC/DKIM/custom MAIL FROM DNS, From-domain alignment, and
the latest matching Listmonk bounce event. If no provider event exists yet,
webhook freshness is reported as `unknown` rather than inventing a failure.
It verifies the selected Listmonk messenger and real `app.from_email`, follows
the bounded DMARC DNS tree walk for inherited policy and strict/relaxed
alignment, and accepts an unambiguous delegated CNAME or direct TXT DKIM
record. Provider profiles that reuse a messenger name fail the binding check
even when their SMTP endpoints differ, because campaign execution selects the
messenger rather than a provider profile. Provider profiles therefore accept
only Listmonk's built-in `email` messenger; custom HTTP messengers are separate
delivery backends and cannot prove an SMTP provider binding. Describe one
Listmonk SMTP pool with one profile and list every expected pool endpoint in
`smtp_hosts`. Readiness requires the complete enabled host set and configured
SMTP username fingerprint set to match exactly; each expected host must appear
once, so duplicate, partial, and unexpected enabled routes fail closed. For
generic SMTP direct SPF policies, configure every possible sender range in
`expected_spf_ip_ranges`, or configure the provider's `expected_spf_include`
instead. Direct-range validation follows SPF term order, CIDR containment, and
the shared DNS and void-lookup budgets recursively through nested includes.
Partial range authorization is preserved across include paths, and `a`/`mx`
mechanisms must resolve to the configured sender ranges rather than merely
publishing address records. IPv4 and IPv6 void-lookup budgets are evaluated
independently, and an MX exchange with more than ten addresses fails closed.
Scoped IPv6 literals are rejected because they are not valid SPF network
terms. Provider-returned DKIM selectors are validated before any DNS query.
When SES identity inspection succeeds, its custom MAIL FROM result is
authoritative; `mail_from_domain` is only fallback evidence when identity
inspection is unavailable. When multiple profiles share one webhook source,
event freshness remains `unknown` because Listmonk cannot attribute that
evidence to one profile.
Transient DNS failures remain `unknown`, while SES sandbox access blocks the
aggregate readiness result.
Generic SMTP profiles support Listmonk, DNS, and webhook diagnostics; provider
API and quota probes report `unsupported`.

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

### Rendered campaign preflight

Preflight now requests the server-rendered campaign preview, including the shared
template footer, instead of searching raw body words or counting braces. A native
Listmonk subscription URL must appear in an HTML anchor (or as a URL in a plain
text preview). Preview errors and empty/oversized content fail closed.

Link health checks inspect ordinary rendered anchors and bare URLs in plain-text
previews. Native subscription,
opt-in and tracking routes, recognized authentication paths and credential-bearing
query links are excluded; they are never visited by this check. Keep `check_links`
disabled for messages containing custom action links whose behavior is unknown.

This is a sample-render check, not a guarantee for all subscriber-specific
conditional branches, CSS visibility or custom unsubscribe services. It verifies
native route presence, not the ownership/reachability of a remote unsubscribe
endpoint. It does not create a durable approval token or make later sends atomic.

### List-scoped sequence consent

Add `consent_list_ids` to each newsletter send step in the JSON passed to
`sequences create/update` (MCP uses the same step schema):

```json
{"id":"newsletter","type":"send","template_id":1,"consent_list_ids":[42]}
```

Every listed membership must currently permit delivery. Unsubscribed or missing
membership cancels the enrollment before sending; an unrelated subscribed list
cannot substitute for it. Confirmed members are eligible; unconfirmed members
are eligible only when a fresh list lookup reports single opt-in. Unknown policy
or missing list-read permission fails closed. Global suppression always wins.
This check runs before every send, including later steps after enrollment.

**Migration:** policy absence retains legacy transactional behavior; old sequences
are not silently assigned a mailing purpose. Add the scope explicitly. Existing
enrollments remain pinned to their old revision; updating a definition protects
new enrollments, not already-enrolled recipients. Pause/drain old enrollments and
review re-enrollment before enabling newsletter automation. Upgrade every worker
and writer before using the new field; older binaries do not enforce it.

### Deliverability guard observation policy

`ops guard --pause-on-breach` automatically pauses **running** campaigns for
bounce breaches only. Open/click breaches remain advisory by default and are
evaluated only after both `--minimum-sent` (100) and
`--minimum-observation-seconds` (3600) are satisfied. Missing, invalid or future
`started_at` values cannot authorize engagement evaluation.

To deliberately enable engagement-based pausing, provide
`--pause-on-breach --pause-on-engagement-breach --confirm`. MCP uses the matching
`pause_on_breach`, `pause_on_engagement_breach` and
`minimum_observation_seconds` fields. A pause rechecks the campaign revision and
uses the shared lifecycle rules; scheduled campaigns are never directly paused.
The `campaign.deliverability-guard` playbook requires an explicit boolean
`pause_on_engagement_breach` input. Set it to `false` for bounce-only pausing or
`true` to allow mature open/click breaches to pause after approval.
