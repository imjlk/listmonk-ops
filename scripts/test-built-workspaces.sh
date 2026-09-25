#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# This is the post-build CI entrypoint, not a replacement for standalone tests.
for workspace in common openapi operations automation abtest mcp; do
  if [[ ! -f "packages/$workspace/dist/index.js" ]]; then
    echo "Missing build for $workspace. Run bun run check && bun run build first." >&2
    exit 1
  fi
done
if [[ ! -f apps/cli/dist/js/index.js ]]; then
  echo "Missing CLI build. Run bun run check && bun run build first." >&2
  exit 1
fi

# Preserve package working directories and process isolation (mocks and env).
bun test scripts
for workspace in common openapi operations automation abtest; do
  (cd "packages/$workspace" && bun test tests)
done
(cd apps/cli && bun test tests)
(cd packages/mcp && bun test tests/unit)
