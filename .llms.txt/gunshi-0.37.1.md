# Gunshi 0.37.1 project notes

The CLI pins `gunshi` and `@gunshi/plugin-completion` to `0.37.1`.

Project conventions:

- Define commands with `define()` and invoke the root with `cli()`.
- Compose groups with nested `subCommands` objects.
- Register `completion()` in the root `plugins` array. The canonical user
  command is `listmonk-cli complete <bash|zsh|fish|powershell>`.
- Keep framework adaptation in `apps/cli/src/lib/command.ts`. Command modules
  use the local `defineCommand`, `defineGroup`, and `option` helpers instead of
  importing Gunshi directly.
- Use Gunshi custom argument parsers to retain Zod validation and coercion.
- Boolean arguments are negatable (`--flag` / `--no-flag`). The adapter keeps
  explicit `--flag true|false` input temporarily for backwards compatibility.

Primary documentation:

- https://gunshi.dev/llms.txt
- https://gunshi.dev/guide/advanced/nested-sub-commands
- https://github.com/kazupon/gunshi/blob/v0.37.1/packages/plugin-completion/README.md
- https://github.com/kazupon/gunshi/releases/tag/v0.37.1
