#!/usr/bin/env bash
set -euo pipefail

REPO="${LISTMONK_CLI_REPO:-imjlk/listmonk-ops}"
INSTALL_DIR="${LISTMONK_CLI_INSTALL_DIR:-$HOME/.local/bin}"
REQUESTED_VERSION="${LISTMONK_CLI_VERSION:-latest}"

print_help() {
	cat <<'EOF'
Install listmonk-cli from GitHub Releases.
The archive must match the release's SHA-256 checksums.txt; otherwise
nothing is installed.

Usage:
  install-listmonk-cli.sh [--version <tag-or-version>] [--repo <owner/repo>] [--install-dir <path>]

Examples:
  install-listmonk-cli.sh
  install-listmonk-cli.sh --version @listmonk-ops/cli-v0.3.0
  install-listmonk-cli.sh --version 0.3.0
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

if [[ "$os" == "darwin" && "$arch" == "x64" ]]; then
	if [[ "$(sysctl -in sysctl.proc_translated 2>/dev/null || true)" == "1" ]]; then
		arch="arm64"
	else
		echo "Unsupported platform: macOS Intel (darwin-x64). macOS releases require Apple silicon (arm64)." >&2
		exit 1
	fi
fi

asset_name="listmonk-cli-${os}-${arch}.tar.gz"

resolve_latest_tag() {
	curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
		| sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
		| head -n 1
}

release_asset_url() {
	local tag="$1"
	local name="$2"
	local encoded_tag="${tag//%/%25}"
	encoded_tag="${encoded_tag//@/%40}"
	encoded_tag="${encoded_tag//\//%2F}"
	echo "https://github.com/${REPO}/releases/download/${encoded_tag}/${name}"
}

download_from_tag() {
	local tag="$1"
	local out="$2"
	if curl -fsSL "$(release_asset_url "$tag" "$asset_name")" -o "$out"; then
		echo "$tag"
		return 0
	fi
	return 1
}

to_lower() {
	printf '%s\n' "$1" | tr '[:upper:]' '[:lower:]'
}

# Hash from stdin so the output never carries an escaped file name.
sha256_of() {
	local digest
	if command -v sha256sum >/dev/null 2>&1; then
		digest="$(sha256sum <"$1")" || return 1
	elif command -v shasum >/dev/null 2>&1; then
		digest="$(shasum -a 256 <"$1")" || return 1
	else
		echo "Neither sha256sum nor shasum is available to verify ${asset_name}; refusing to install" >&2
		return 1
	fi
	to_lower "${digest%% *}"
}

# Every release publishes checksums.txt (`sha256sum *.tar.gz`). Fail closed:
# never install an archive that is not listed there with a matching digest.
verify_archive_checksum() {
	local tag="$1"
	local archive="$2"
	local checksums="$tmp_dir/checksums.txt"
	local expected=""
	local actual=""
	local digest name

	if ! curl -fsSL "$(release_asset_url "$tag" checksums.txt)" -o "$checksums"; then
		echo "Could not download checksums.txt for ${REPO}@${tag}; refusing to install an unverified ${asset_name}" >&2
		return 1
	fi
	while read -r digest name _ || [[ -n "${digest:-}" ]]; do
		name="${name%$'\r'}"
		if [[ "$name" == "$asset_name" || "$name" == "*$asset_name" ]]; then
			expected="$(to_lower "$digest")"
			break
		fi
		digest=""
	done <"$checksums"
	if [[ ! "$expected" =~ ^[0-9a-f]{64}$ ]]; then
		echo "checksums.txt for ${REPO}@${tag} has no SHA-256 entry for ${asset_name}; refusing to install" >&2
		return 1
	fi
	actual="$(sha256_of "$archive")" || return 1
	if [[ "$actual" != "$expected" ]]; then
		echo "Checksum mismatch for ${asset_name} from ${REPO}@${tag}: expected ${expected}, got ${actual}; refusing to install" >&2
		return 1
	fi
	echo "Verified ${asset_name} SHA-256 against checksums.txt"
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
		candidates=("@listmonk-ops/cli-v$REQUESTED_VERSION" "listmonk-ops-cli-v$REQUESTED_VERSION" "v$REQUESTED_VERSION" "$REQUESTED_VERSION")
	elif [[ "$REQUESTED_VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
		candidates=("@listmonk-ops/cli-$REQUESTED_VERSION" "listmonk-ops-cli-$REQUESTED_VERSION" "$REQUESTED_VERSION")
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

verify_archive_checksum "$resolved_tag" "$archive_path" || exit 1

mkdir -p "$INSTALL_DIR"
tar -xzf "$archive_path" -C "$tmp_dir"
install -m 0755 "$tmp_dir/listmonk-cli-${os}-${arch}" "$INSTALL_DIR/listmonk-cli"

echo "Installed listmonk-cli from ${REPO}@${resolved_tag} to ${INSTALL_DIR}/listmonk-cli"
if ! command -v listmonk-cli >/dev/null 2>&1; then
	echo "Add ${INSTALL_DIR} to your PATH to run 'listmonk-cli' directly."
fi
