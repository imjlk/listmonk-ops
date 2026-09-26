# @listmonk-ops/cli

Gunshi-based CLI for Listmonk operations.

## Install

With Bun:

```bash
bun add -g @listmonk-ops/cli
```

The npm package targets the Bun runtime. If you need a no-runtime-dependency install, use the standalone binary instead.

Or install from GitHub Releases (standalone binary):

```bash
curl -fsSL https://raw.githubusercontent.com/imjlk/listmonk-ops/main/scripts/install-listmonk-cli.sh | bash
```

Prebuilt standalone binaries are available for Linux x64/arm64 and Apple
silicon macOS (arm64). Intel Macs are not supported.

Both distributions load `.env` files from the current working directory, and
those values can change the connection target and credential source, so run
`listmonk-cli` only from directories you trust. The standalone binary never
loads `bunfig.toml`; the npm package runs through `bun`, which also applies a
working-directory `bunfig.toml`, including `preload` scripts that execute code.

## Usage

```bash
listmonk-cli --help
listmonk-cli status
listmonk-cli campaigns list
listmonk-cli lists create --name "Product updates"
listmonk-cli media list
listmonk-cli ops digest --hours 24
listmonk-cli operations --family campaigns
listmonk-cli specs search --query "schedule campaign"
listmonk-cli specs describe --operation campaigns.schedule
listmonk-cli playbooks get --id campaign.safe-start
listmonk-cli capabilities
listmonk-cli prime --goal "schedule campaign"
listmonk-cli webhooks list
listmonk-cli sequences list
listmonk-cli providers list
listmonk-cli deliverability doctor --provider-id marketing-primary
```

`listmonk-cli operations` lists the shared typed contracts available through
both the CLI and MCP server. Use `--family` to filter by `lists`,
`subscribers`, `campaigns`, `templates`, `media`, `transactional`, `ops`,
`abtest`, `discovery`, `webhooks`, `sequences`, or `providers`.

`specs search` and `specs describe` expose effect-derived safety, execution
requirements, retry semantics, and agent guidance. `playbooks` returns typed
multi-step workflows. `capabilities` and `prime` require no credentials;
`status` separates public health, authentication, and optional scoped collection
reads. `status --check` exits nonzero unless the requested checks pass.

Use `--profile NAME` and optional `--config PATH` to select the same connection
profile as MCP. `config show --format json` reports profile names, configuration
sources, authentication references, and the default state directory without
reading token values. Profiles reference tokens through `tokenEnv` or `tokenFile`;
`--token-file` overrides the reference for a command. Each command reads the
current token file. Profiles have separate default file-backed state directories;
explicit per-store paths and Postgres settings retain precedence. See the root
[English](https://github.com/imjlk/listmonk-ops#shared-connection-profiles) /
[Korean](https://github.com/imjlk/listmonk-ops/blob/main/README_ko.md) configuration
guide for the JSON format, precedence, path resolution, and rotation behavior.

`tx records --format json` inspects redacted, target-bound transactional send
records. `tx reconcile --key KEY --expected-revision REVISION --decision
accepted|retry --reason TEXT --confirm` records a verified operator decision.
Use `tx records --cursor CURSOR` to read later pages. Both local commands work
without a readable API token; `--interactive` can select a previously prompted
send target.
The `retry` decision only unblocks a later explicit send and requires elapsed
TTL plus `--quiesced` after stopping the sender. A verified `accepted` decision
does not wait for TTL because it never dispatches mail.
With `LISTMONK_OPS_SEQUENCE_DATABASE_URL`, transactional sends and these
inspection commands share the sequence PostgreSQL claim store. For an
ambiguous sequence enrollment, reconcile its claim first, then resolve the
enrollment as `sent` after `accepted` or `not_sent` after `retry`.

ID flags and comma-separated ID lists such as `--lists 10,11` accept only
positive decimal integers; a malformed entry such as `12,O4` or `0x10` fails
the command instead of being dropped or reinterpreted.

Shared operations with `confirmationRequired: true` need the global
`--confirm` flag, for example `listmonk-cli lists delete --id 10 --confirm`.
Media deletion follows the same policy:
`listmonk-cli media delete --id 10 --confirm`.
The CLI records metadata-only audit events for shared writes in
`<resolved-data-directory>/operation-audit.json` by default; set
`LISTMONK_OPS_AUDIT_STORE` to use a different local path.

Versioned template manifests use the same normalized 1 MiB payload limit as
MCP. The command plans by default, accepts at most 500 entries from a JSON file
up to 1 MiB, and returns only template names, actions, and apply state:

```bash
listmonk-cli templates reconcile --manifest-file ./templates.json --confirm
listmonk-cli templates reconcile --manifest-file ./templates.json \
  --no-dry-run --confirm
```

The manifest root is `{ "schema_version": 1, "templates": [...] }`. Exact-name
duplicates fail closed and the complete manifest is planned before the first
write. Listmonk does not provide a multi-template transaction, so retry the
same desired state after inspecting any partial failure.

Versioned user-role manifests use the same normalized 1 MiB payload limit and
500-role cap. The command plans by default, never manages the protected Super
Admin role (ID 1), and returns only role names, actions, and apply state:

```bash
listmonk-cli user-roles reconcile --manifest-file ./roles.json --confirm
listmonk-cli user-roles reconcile --manifest-file ./roles.json \
  --no-dry-run --confirm
```

The manifest root is `{ "schema_version": 1, "roles": [...] }`, where each role
declares an exact `name` and a `permissions` array from the Listmonk 6.2
vocabulary. The credential running role reconciliation needs `roles:get` plus
`roles:manage` and must be separate from the runtime delivery role.

The `webhooks` command group manages signed outbound event endpoints and the
shared durable outbox:

```bash
listmonk-cli webhooks create \
  --name operations \
  --url https://events.example.com/listmonk \
  --secret-ref LISTMONK_OPS_WEBHOOK_SECRET \
  --event-filters 'operation.*,campaign.*' \
  --circuit-failure-threshold 5 \
  --circuit-cooldown-ms 300000
listmonk-cli webhooks test --id <endpoint-uuid> --confirm
listmonk-cli webhooks tick --confirm
listmonk-cli webhooks reconcile
listmonk-cli webhooks reconcile --no-dry-run
listmonk-cli webhooks prune --older-than-days 30 --dry-run
listmonk-cli webhooks prune --before <cutoff> --ids <ids-from-dry-run> --no-dry-run --confirm
listmonk-cli webhooks deliveries list --status exhausted
listmonk-cli webhooks deliveries retry --id <delivery-uuid> --confirm
listmonk-cli webhooks runtime status
listmonk-cli webhooks runtime worker --confirm
listmonk-cli webhooks dlq list
listmonk-cli webhooks dlq replay --delivery-ids <ids-from-dry-run> --no-dry-run --confirm
listmonk-cli webhooks circuit reset --id <endpoint-uuid> --confirm
listmonk-cli webhooks inbound ingest --provider ses \
  --provider-event-id <event-id> --kind bounced
```

`secret-ref` names an environment variable; the secret value is never stored.
Set `LISTMONK_OPS_WEBHOOK_STORE` to share a non-default endpoint/outbox path
between CLI and MCP processes. For concurrent workers, set
`LISTMONK_OPS_WEBHOOK_DATABASE_URL` instead; the file and database settings are
mutually exclusive.
The long-running worker records heartbeats and handles SIGINT/SIGTERM
gracefully, retries transient tick failures with bounded backoff, and reports
progress. Runtime status includes Postgres/file schema version, backlog,
circuits, dead letters, and running, stale, stopped, or failed workers. Provider ingestion is idempotent by
stable provider event ID; unsubscribe events require a subscriber UUID and
metadata is capped at 16 KiB.

The `sequences` group manages revisioned headless subscriber journeys:

```bash
listmonk-cli sequences create --name welcome \
  --steps '[{"id":"send","type":"send","template_id":12},{"id":"stop","type":"stop"}]'
listmonk-cli sequences enroll --id <sequence-uuid> --subscriber-id 42
listmonk-cli sequences enrollments list --status ambiguous
listmonk-cli sequences enrollments get --id <enrollment-uuid>
listmonk-cli sequences status
listmonk-cli sequences tick --confirm
listmonk-cli sequences reconcile --dry-run --confirm
listmonk-cli sequences worker --confirm
```

Set `LISTMONK_OPS_SEQUENCE_STORE` for a custom single-host file or
`LISTMONK_OPS_SEQUENCE_DATABASE_URL` for concurrent Postgres workers. These
settings are mutually exclusive. Ambiguous sends require an operator-reviewed
`sent` or `not_sent` reconciliation and are never retried automatically.
Postgres mode stores sequence state and transactional idempotency claims
together so concurrent workers share the same send decision.

The `providers` and `deliverability` groups expose read-only provider health:

```bash
listmonk-cli providers status --provider-id marketing-primary
listmonk-cli providers test --provider-id marketing-primary
listmonk-cli providers quota --provider-id marketing-primary
listmonk-cli providers webhook-status --provider-id marketing-primary
listmonk-cli deliverability dns-check --provider-id marketing-primary
listmonk-cli deliverability doctor --provider-id marketing-primary
```

Set `LISTMONK_OPS_PROVIDER_CONFIG` to a versioned JSON profile file. SES
profiles use `aws:default` or `aws:profile:<name>` credential references; raw
access keys are rejected and neither references nor credentials are returned.
The probes read SES account/identity state, Listmonk configuration and bounce
evidence, and DNS records. They validate the selected messenger and From
address, follow inherited DMARC policy and strict/relaxed alignment, and
distinguish transient DNS failures from missing records. Shared messenger/SMTP
bindings fail closed, while webhook sources shared by multiple profiles report
unattributable freshness as `unknown`. They never send mail.

## Shell completion

```bash
listmonk-cli complete zsh
listmonk-cli complete bash
listmonk-cli complete fish
listmonk-cli complete powershell
```

The older `listmonk-cli completions <shell>` spelling remains a deprecated alias.

## Machine-readable output

`--format json` and `--format ndjson` keep result data on stdout without a
banner. Empty resource lists produce `[]`; NDJSON lists remain single-line
arrays. Failures exit nonzero with `{"error":{"code":"cli_error","message":"..."}}`
on stderr. JSON mode includes buffered auxiliary `diagnostics` in that document
(up to 20 messages of 1,024 characters). NDJSON streams each diagnostic immediately
as `{"diagnostic":{"level":"info","message":"..."}}` on stderr; parse each line
separately. Levels distinguish success/info/warning/error; stacks and arbitrary
object details are omitted. Quiet mode omits auxiliary diagnostics.

Long-running sequence/webhook workers accept NDJSON, human, or quiet mode;
buffered JSON mode is rejected. Human command errors omit runtime stacks.
Keep stdout and stderr separate. Help, version, and completion retain text formats.
Interactive prompts and `ops digest --markdown-only` require human mode.
