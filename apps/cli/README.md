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
```

`listmonk-cli operations` lists the shared typed contracts available through
both the CLI and MCP server. Use `--family` to filter by `lists`,
`subscribers`, `campaigns`, `templates`, `media`, `transactional`, `ops`, or
`abtest`.

Shared operations with `confirmationRequired: true` need the global
`--confirm` flag, for example `listmonk-cli lists delete --id 10 --confirm`.
Media deletion follows the same policy:
`listmonk-cli media delete --id 10 --confirm`.
The CLI records metadata-only audit events for shared writes in
`$HOME/.listmonk-ops/operation-audit.json` by default; set
`LISTMONK_OPS_AUDIT_STORE` to use a different local path.

## Shell completion

```bash
listmonk-cli complete zsh
listmonk-cli complete bash
listmonk-cli complete fish
listmonk-cli complete powershell
```

The older `listmonk-cli completions <shell>` spelling remains a deprecated alias.
