#!/usr/bin/env bash
set -euo pipefail

BASE_REF="${1:-origin/main}"
HEAD_REF="${2:-}"
PR_NUMBER="${3:-0}"
AUTO_FILE=".sampo/changesets/renovate-pr-${PR_NUMBER}.md"

declare -a PACKAGE_MAPPINGS=(
  "apps/cli/:npm/@listmonk-ops/cli"
  "packages/openapi/:npm/@listmonk-ops/openapi"
  "packages/common/:npm/@listmonk-ops/common"
  "packages/abtest/:npm/@listmonk-ops/abtest"
  "packages/automation/:npm/@listmonk-ops/automation"
  "packages/mcp/:npm/@listmonk-ops/mcp"
)

if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  echo "[renovate-changeset] Base ref '$BASE_REF' not found."
  exit 1
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
  rm -f "$AUTO_FILE"
  echo "[renovate-changeset] No file changes detected."
  exit 0
fi

manual_changeset_detected="false"
while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  if [[ "$file" == .sampo/changesets/*.md && "$file" != "$AUTO_FILE" ]]; then
    manual_changeset_detected="true"
    break
  fi
done <<< "$changed_files"

if [[ "$manual_changeset_detected" == "true" ]]; then
  rm -f "$AUTO_FILE"
  echo "[renovate-changeset] Manual changeset already present. Skipping auto file."
  exit 0
fi

declare -a packages=()
for mapping in "${PACKAGE_MAPPINGS[@]}"; do
  path_prefix="${mapping%%:*}"
  package_name="${mapping#*:}"
  if echo "$changed_files" | grep -q "^${path_prefix}"; then
    packages+=("$package_name")
  fi
done

if [[ "${#packages[@]}" -eq 0 ]]; then
  rm -f "$AUTO_FILE"
  echo "[renovate-changeset] No releasable package changes detected."
  exit 0
fi

mkdir -p "$(dirname "$AUTO_FILE")"

{
  echo "---"
  for package_name in "${packages[@]}"; do
    echo "${package_name}: patch (Changed)"
  done
  echo "---"
  echo
  echo "Maintenance dependency update generated for a Renovate PR."
} > "$AUTO_FILE"

echo "[renovate-changeset] Wrote ${AUTO_FILE}"
