#!/usr/bin/env bash
set -euo pipefail

token="${NODE_AUTH_TOKEN:-${NPM_PUBLISH_TOKEN:-}}"

if [[ -n "${token}" ]]; then
	tmp_config="$(mktemp -t listmonk-ops-npmrc)"
	trap 'rm -f "${tmp_config}"' EXIT
	umask 077
	cat >"${tmp_config}" <<EOF
//registry.npmjs.org/:_authToken=${token}
EOF
	export NPM_CONFIG_USERCONFIG="${tmp_config}"
fi

exec sampo publish "$@"
