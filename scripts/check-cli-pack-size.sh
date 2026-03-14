#!/usr/bin/env bash
set -euo pipefail

MAX_UNPACKED_SIZE_BYTES="${MAX_UNPACKED_SIZE_BYTES:-1000000}"
MAX_TARBALL_SIZE_BYTES="${MAX_TARBALL_SIZE_BYTES:-250000}"

pack_json="$(npm pack --dry-run --json --workspace @listmonk-ops/cli)"

PACK_JSON="$pack_json" \
MAX_UNPACKED_SIZE_BYTES="$MAX_UNPACKED_SIZE_BYTES" \
MAX_TARBALL_SIZE_BYTES="$MAX_TARBALL_SIZE_BYTES" \
node <<'EOF'
const raw = process.env.PACK_JSON;

if (!raw) {
  console.error("[cli-pack-size] Missing npm pack output.");
  process.exit(1);
}

const [result] = JSON.parse(raw);
if (!result) {
  console.error("[cli-pack-size] npm pack did not return a workspace result.");
  process.exit(1);
}

const unpackedSize = Number(result.unpackedSize ?? 0);
const tarballSize = Number(result.size ?? 0);
const maxUnpacked = Number(process.env.MAX_UNPACKED_SIZE_BYTES);
const maxTarball = Number(process.env.MAX_TARBALL_SIZE_BYTES);

console.log(
  `[cli-pack-size] unpacked=${unpackedSize}B tarball=${tarballSize}B thresholds=${maxUnpacked}B/${maxTarball}B`
);

if (unpackedSize > maxUnpacked) {
  console.error(
    `[cli-pack-size] Unpacked size ${unpackedSize}B exceeds limit ${maxUnpacked}B.`
  );
  process.exit(1);
}

if (tarballSize > maxTarball) {
  console.error(
    `[cli-pack-size] Tarball size ${tarballSize}B exceeds limit ${maxTarball}B.`
  );
  process.exit(1);
}
EOF
