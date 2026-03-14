#!/usr/bin/env bash
set -euo pipefail

BASE_REF="${1:-origin/main}"
HEAD_REF="${2:-}"
RELEASABLE_PATTERN='^(apps/cli/|packages/openapi/|packages/automation/|packages/common/|packages/abtest/|packages/mcp/)'

if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
	echo "[sampo-check] Base ref '$BASE_REF' not found. Skipping changeset check."
	exit 0
fi

if [[ -n "$HEAD_REF" ]]; then
	changed_files="$(git diff --name-only "$BASE_REF" "$HEAD_REF")"
else
	changed_files="$(git diff --name-only "$BASE_REF")"
	untracked_files="$(git ls-files --others --exclude-standard)"
	if [[ -n "$untracked_files" ]]; then
		changed_files="${changed_files}"$'\n'"${untracked_files}"
	fi
fi

if [[ -z "$changed_files" ]]; then
	echo "[sampo-check] No file changes detected."
	exit 0
fi

if ! echo "$changed_files" | grep -Eq "$RELEASABLE_PATTERN"; then
	echo "[sampo-check] No releasable package changes detected."
	exit 0
fi

if echo "$changed_files" | grep -Eq '^\.sampo/changesets/.*\.md$'; then
	echo "[sampo-check] Changeset file detected."
	exit 0
fi

echo "[sampo-check] Releasable package changes were detected, but no changeset was added."
echo "[sampo-check] Run 'bun run release:add' and commit the generated .sampo/changesets/*.md file."
echo "[sampo-check] Changed releasable files:"
echo "$changed_files" | grep -E "$RELEASABLE_PATTERN" || true
exit 1
