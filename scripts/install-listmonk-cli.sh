#!/usr/bin/env bash
set -euo pipefail

REPO="${LISTMONK_CLI_REPO:-imjlk/listmonk-ops}"
INSTALL_DIR="${LISTMONK_CLI_INSTALL_DIR:-$HOME/.local/bin}"
REQUESTED_VERSION="${LISTMONK_CLI_VERSION:-latest}"

print_help() {
	cat <<'EOF'
Install listmonk-cli from GitHub Releases.

Usage:
  install-listmonk-cli.sh [--version <tag-or-version>] [--repo <owner/repo>] [--install-dir <path>]

Examples:
  install-listmonk-cli.sh
  install-listmonk-cli.sh --version listmonk-ops-cli-v0.2.1
  install-listmonk-cli.sh --version 0.2.1
  LISTMONK_CLI_INSTALL_DIR=/usr/local/bin install-listmonk-cli.sh
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--version|-v)
			REQUESTED_VERSION="${2:-}"
			shift 2
			;;
		--repo)
			REPO="${2:-}"
			shift 2
			;;
		--install-dir)
			INSTALL_DIR="${2:-}"
			shift 2
			;;
		--help|-h)
			print_help
			exit 0
			;;
		*)
			echo "Unknown option: $1" >&2
			print_help
			exit 1
			;;
	esac
done

if [[ -z "$REPO" ]]; then
	echo "Repository must not be empty" >&2
	exit 1
fi

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m | tr '[:upper:]' '[:lower:]')"

case "$os" in
	darwin) os="darwin" ;;
	linux) os="linux" ;;
	*)
		echo "Unsupported OS: $os" >&2
		exit 1
		;;
esac

case "$arch" in
	x86_64|amd64) arch="x64" ;;
	arm64|aarch64) arch="arm64" ;;
	*)
		echo "Unsupported architecture: $arch" >&2
		exit 1
		;;
esac

asset_name="listmonk-cli-${os}-${arch}.tar.gz"

resolve_latest_tag() {
	curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
		| sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
		| head -n 1
}

download_from_tag() {
	local tag="$1"
	local out="$2"
	local url="https://github.com/${REPO}/releases/download/${tag}/${asset_name}"
	if curl -fsSL "$url" -o "$out"; then
		echo "$tag"
		return 0
	fi
	return 1
}

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

archive_path="$tmp_dir/$asset_name"
resolved_tag=""

if [[ "$REQUESTED_VERSION" == "latest" ]]; then
	resolved_tag="$(resolve_latest_tag)"
	if [[ -z "$resolved_tag" ]]; then
		echo "Could not resolve latest release tag from ${REPO}" >&2
		exit 1
	fi
	download_from_tag "$resolved_tag" "$archive_path" >/dev/null
else
	candidates=("$REQUESTED_VERSION")
	if [[ "$REQUESTED_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
		candidates=("listmonk-ops-cli-v$REQUESTED_VERSION" "v$REQUESTED_VERSION" "$REQUESTED_VERSION")
	elif [[ "$REQUESTED_VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
		candidates=("listmonk-ops-cli-$REQUESTED_VERSION" "$REQUESTED_VERSION")
	fi

	for tag in "${candidates[@]}"; do
		if download_from_tag "$tag" "$archive_path" >/dev/null; then
			resolved_tag="$tag"
			break
		fi
	done

	if [[ -z "$resolved_tag" ]]; then
		echo "Failed to download ${asset_name} for version '${REQUESTED_VERSION}' from ${REPO}" >&2
		exit 1
	fi
fi

mkdir -p "$INSTALL_DIR"
tar -xzf "$archive_path" -C "$tmp_dir"
install -m 0755 "$tmp_dir/listmonk-cli-${os}-${arch}" "$INSTALL_DIR/listmonk-cli"

echo "Installed listmonk-cli from ${REPO}@${resolved_tag} to ${INSTALL_DIR}/listmonk-cli"
if ! command -v listmonk-cli >/dev/null 2>&1; then
	echo "Add ${INSTALL_DIR} to your PATH to run 'listmonk-cli' directly."
fi
