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
# Optional: override the transactional idempotency store
export LISTMONK_OPS_TRANSACTIONAL_STORE="$HOME/.listmonk-ops/transactional.json"
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
listmonk-cli campaigns schedule --id 42 --send-at 2026-08-01T09:00:00Z --confirm
listmonk-cli campaigns start --id 42 --confirm
listmonk-cli campaigns pause --id 42
listmonk-cli campaigns cancel --id 42 --confirm
listmonk-cli campaigns clone --id 42 --name "Copy of Weekly update"
listmonk-cli campaigns stats --id 42

listmonk-cli subscribers create --email reader@example.com --name Reader
listmonk-cli subscribers update --id 7 --status enabled
listmonk-cli subscribers delete --id 7 --confirm
listmonk-cli subscribers add-to-lists --subscriber-ids 1,2,3 --list-ids 10,20
listmonk-cli subscribers remove-from-lists --subscriber-ids 1,2 --list-ids 10 --confirm
listmonk-cli subscribers blocklist --subscriber-ids 1,2,3 --confirm
listmonk-cli subscribers unblocklist --subscriber-ids 1,2

listmonk-cli templates create --name "Campaign HTML" --body "<p>Hello</p>"
listmonk-cli templates update --id 3 --body "<p>Updated</p>"
listmonk-cli templates delete --id 3 --confirm
listmonk-cli templates set-default --id 3

listmonk-cli media list --page 1 --per-page 20
listmonk-cli media get --id 9
listmonk-cli media delete --id 9 --confirm
listmonk-cli media upload --file ./banner.png
```

Campaign lifecycle transitions are validated client-side against an
observed state machine (`draft → scheduled/running`, `scheduled →
running`, `running → paused/cancelled`, `paused → running`,
`finished`/`cancelled` are terminal). Subscriber
bulk operations chunk IDs (default 500 per chunk) and support
`--dry-run`, `--max-items`, and `--continue-on-error`. Media uploads
enforce a MIME allowlist and a 10 MiB size cap.

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
Seven operations currently include a `spec` descriptor: the original
`campaigns.get`, `campaigns.schedule`, and `subscribers.blocklist` pilot plus
the high-risk `campaigns.start`, `campaigns.cancel`, `transactional.send`, and
`ops.campaign.preflight` operations. A descriptor adds normalized
Typia-generated contracts, resource/state semantics, effects, derived safety
policy, retry/reconciliation guidance, and agent usage context. Transactional
send retry semantics are conditional on `idempotency_key`; its recipient
contract is generated as an email-or-ID XOR. Existing Zod schemas remain the
transport normalization and runtime validation authority.

The spec also publishes the typed `campaign.safe-start` playbook. It sequences
campaign inspection, a guarded preflight (`summary.fail == 0`), human-approved
bulk delivery, and post-start verification. Every shared operation must now
bind either a descriptor or a dated migration exemption. Family catalogs and
the post-build `operations:specs:coverage` gate reject missing, dangling,
overlapping, mismatched, or expired coverage.

Operations Spec artifacts are checked in under
`packages/operations/generated/specs`. Run `bun run operations:specs:generate`
after changing a contract or descriptor; `bun run check` rejects generated
drift and verifies that every described operation remains connected to its
named operation invoker and executor in the compiler graph. `bun run build`
also verifies all 58 shared operations against descriptor/exemption coverage.

The spec API is published from the existing operations package through the
`@listmonk-ops/operations/specs` subpath; it is not a separate npm package.

For a destructive shared MCP operation, include the MCP-only
`"confirm": true` input. The adapter removes that control before invoking the
typed domain operation. A `dry_run: true` request is accepted only when the
cataloged operation explicitly supports a real dry run; unsupported dry-run
requests are rejected instead of being simulated. Mutating shared MCP
operations append `started`, `blocked`, `succeeded`, or `failed` metadata-only
events to `$HOME/.listmonk-ops/operation-audit.json` by default. The staged
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
- Records an ambiguous transport failure (timeout, connection reset) as
  `unknown` and blocks automatic retry — inspect Listmonk and the idempotency
  record, then reconcile manually.

The store path defaults to `~/.listmonk-ops/transactional.json`; override it
with `LISTMONK_OPS_TRANSACTIONAL_STORE`.

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
listmonk-cli abtest run --test-id <id> --confirm
listmonk-cli abtest tick --dry-run true --confirm
listmonk-cli abtest tick --confirm
listmonk-cli abtest reconcile --test-id <id>
listmonk-cli abtest reconcile --all --repair --confirm
```

Creating with `--auto-launch true` starts the backing campaigns immediately;
review that flag as a sending operation before using it in automation.

`abtest tick` advances every non-terminal test one lifecycle step (for
cron/systemd timers). Use `--dry-run true` to preview without mutating.
`abtest run` progresses a single test. `abtest reconcile` reports local
drift and can repair with `--repair --confirm`.

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
  and compute a constrained quota matrix so each provider stratum gets a
  proportional share of every variant/holdout group. The quota matrix is
  computed and stored on the test for reporting/validation; applying it to
  the actual assignment slices is deferred to a follow-up change set.

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

# 4) Segment drift snapshot
listmonk-cli ops segment-drift --threshold 0.2 --min-absolute-change 50
# Use --baseline-mode lookback-mean to compare against the lookback
# window average instead of the previous snapshot.

# 5) Template registry/versioning
listmonk-cli ops templates-sync
listmonk-cli ops templates-history --template-id 10
listmonk-cli ops templates-promote --template-id 10 --version-id v_... --confirm
listmonk-cli ops templates-rollback --template-id 10 --confirm

# 6) Daily digest
listmonk-cli ops digest --hours 24 --output /tmp/listmonk-ops-digest.md
```

Preflight link checking now blocks private/internal hosts (loopback,
private CIDRs, link-local, cloud metadata IPs) and follows redirects
manually with per-hop revalidation. Template promote supports
optimistic concurrency via `--expected-remote-hash`. MCP/CLI operation outputs
no longer expose absolute filesystem paths.

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
