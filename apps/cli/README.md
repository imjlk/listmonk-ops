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
```

`listmonk-cli operations` lists the shared typed contracts available through
both the CLI and MCP server. Use `--family` to filter by `lists`,
`subscribers`, `campaigns`, `templates`, `media`, `transactional`, `ops`, or
`abtest`, or `discovery`.

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
  --event-filters 'operation.*,campaign.*'
listmonk-cli webhooks test --id <endpoint-uuid> --confirm
listmonk-cli webhooks tick --confirm
listmonk-cli webhooks reconcile
listmonk-cli webhooks reconcile --no-dry-run
listmonk-cli webhooks prune --older-than-days 30 --dry-run
listmonk-cli webhooks prune --older-than-days 30 --no-dry-run --confirm
listmonk-cli webhooks deliveries list --status exhausted
listmonk-cli webhooks deliveries retry --id <delivery-uuid> --confirm
```

`secret-ref` names an environment variable; the secret value is never stored.
Set `LISTMONK_OPS_WEBHOOK_STORE` to share a non-default endpoint/outbox path
between CLI and MCP processes. For concurrent workers, set
`LISTMONK_OPS_WEBHOOK_DATABASE_URL` instead; the file and database settings are
mutually exclusive.

## Shell completion

```bash
listmonk-cli complete zsh
listmonk-cli complete bash
listmonk-cli complete fish
listmonk-cli complete powershell
```

The older `listmonk-cli completions <shell>` spelling remains a deprecated alias.
