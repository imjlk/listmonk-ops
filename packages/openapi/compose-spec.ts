import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));
const SPEC_DIR = join(PACKAGE_DIR, "spec");
const UPSTREAM_SPEC = join(SPEC_DIR, "upstream", "listmonk-v6.2.0.yaml");
const OVERLAY_PATCH = join(SPEC_DIR, "listmonk-v6.2.0.overlay.patch");
const OUTPUT_SPEC = join(SPEC_DIR, "listmonk.yaml");
const EXPECTED_UPSTREAM_SHA256 =
	"b9bacc15711f1e9c34260075f7226f81ddb672678b1b7c6f9b90757c21295c53";

const upstream = readFileSync(UPSTREAM_SPEC);
const actualSha256 = createHash("sha256").update(upstream).digest("hex");

if (actualSha256 !== EXPECTED_UPSTREAM_SHA256) {
	throw new Error(
		`Listmonk v6.2.0 spec checksum mismatch: expected ${EXPECTED_UPSTREAM_SHA256}, received ${actualSha256}`,
	);
}

const temporaryDirectory = mkdtempSync(join(SPEC_DIR, ".compose-"));
const temporaryOutput = join(temporaryDirectory, "listmonk.yaml");

try {
	const result = Bun.spawnSync(
		["patch", "-s", "-o", temporaryOutput, UPSTREAM_SPEC, OVERLAY_PATCH],
		{ stdout: "pipe", stderr: "pipe" },
	);

	if (result.exitCode !== 0) {
		throw new Error(
			`Failed to compose Listmonk OpenAPI spec: ${result.stderr.toString().trim()}`,
		);
	}

	renameSync(temporaryOutput, OUTPUT_SPEC);
} finally {
	rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("Composed Listmonk v6.2.0 OpenAPI spec with local overlay");
