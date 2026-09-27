#!/usr/bin/env bash
set -euo pipefail

token="${NODE_AUTH_TOKEN:-${NPM_PUBLISH_TOKEN:-}}"

if [[ -z "${token}" ]]; then
	exec sampo publish "$@"
fi

umask 077
# Spell out the template: GNU mktemp rejects `-t <prefix>` without trailing
# X's. mktemp creates the file with mode 0600 on GNU and BSD alike.
tmp_config="$(mktemp "${TMPDIR:-/tmp}/listmonk-ops-npmrc.XXXXXX")"
trap 'rm -f "${tmp_config}"' EXIT
cat >"${tmp_config}" <<EOF
//registry.npmjs.org/:_authToken=${token}
EOF
export NPM_CONFIG_USERCONFIG="${tmp_config}"

# Run sampo as a child instead of exec-ing it so the EXIT trap still removes
# the token file after publishing, including when sampo fails.
sampo publish "$@"
