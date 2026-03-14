#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

COMMON_DIST="$ROOT_DIR/packages/common/dist/index.js"
OPENAPI_DIST="$ROOT_DIR/packages/openapi/dist/index.js"
AUTOMATION_DIST="$ROOT_DIR/packages/automation/dist/index.js"
ABTEST_DIST="$ROOT_DIR/packages/abtest/dist/index.js"

if [[ -f "$COMMON_DIST" && -f "$OPENAPI_DIST" && -f "$AUTOMATION_DIST" && -f "$ABTEST_DIST" ]]; then
	exit 0
fi

echo "[listmonk-ops] Building runtime workspace dependencies..." >&2

if [[ ! -f "$COMMON_DIST" ]]; then
	bun run --cwd "$ROOT_DIR/packages/common" build
fi

if [[ ! -f "$OPENAPI_DIST" ]]; then
	bun run --cwd "$ROOT_DIR/packages/openapi" build
fi

if [[ ! -f "$AUTOMATION_DIST" ]]; then
	bun run --cwd "$ROOT_DIR/packages/automation" build
fi

if [[ ! -f "$ABTEST_DIST" ]]; then
	bun run --cwd "$ROOT_DIR/packages/abtest" build
fi
