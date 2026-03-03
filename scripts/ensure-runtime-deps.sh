#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

OPENAPI_DIST="$ROOT_DIR/packages/openapi/dist/index.js"
AUTOMATION_DIST="$ROOT_DIR/packages/automation/dist/index.js"

if [[ -f "$OPENAPI_DIST" && -f "$AUTOMATION_DIST" ]]; then
	exit 0
fi

echo "[listmonk-ops] Building runtime workspace dependencies..." >&2

if [[ ! -f "$OPENAPI_DIST" ]]; then
	bun run --cwd "$ROOT_DIR/packages/openapi" build
fi

if [[ ! -f "$AUTOMATION_DIST" ]]; then
	bun run --cwd "$ROOT_DIR/packages/automation" build
fi
