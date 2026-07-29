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
`status` adds the current runtime and a live Listmonk health probe when a token
is configured.

Shared operations with `confirmationRequired: true` need the global
`--confirm` flag, for example `listmonk-cli lists delete --id 10 --confirm`.
Media deletion follows the same policy:
`listmonk-cli media delete --id 10 --confirm`.
The CLI records metadata-only audit events for shared writes in
`$HOME/.listmonk-ops/operation-audit.json` by default; set
`LISTMONK_OPS_AUDIT_STORE` to use a different local path.

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
listmonk-cli webhooks prune --older-than-days 30 --no-dry-run --confirm
listmonk-cli webhooks deliveries list --status exhausted
listmonk-cli webhooks deliveries retry --id <delivery-uuid> --confirm
listmonk-cli webhooks runtime status
listmonk-cli webhooks runtime worker --confirm
listmonk-cli webhooks dlq list
listmonk-cli webhooks dlq replay --no-dry-run --confirm
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
distinguish transient DNS failures from missing records. They never send mail.

## Shell completion

```bash
listmonk-cli complete zsh
listmonk-cli complete bash
listmonk-cli complete fish
listmonk-cli complete powershell
```

The older `listmonk-cli completions <shell>` spelling remains a deprecated alias.
