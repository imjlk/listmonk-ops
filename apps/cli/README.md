# @listmonk-ops/cli

CLI for Listmonk operations.

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
listmonk-cli ops digest --hours 24
```
