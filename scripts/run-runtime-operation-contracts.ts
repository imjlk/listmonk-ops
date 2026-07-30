import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(import.meta.dir, "..");
const temporaryDirectory = await mkdtemp(
	join(tmpdir(), "listmonk-ops-runtime-contracts-"),
);
const output = join(temporaryDirectory, "generate-runtime-contracts.mjs");

try {
	await build({
		entryPoints: [
			resolve(root, "scripts/generate-runtime-operation-contracts.ts"),
		],
		outfile: output,
		bundle: true,
		format: "esm",
		platform: "node",
		target: "node24",
		alias: {
			"@listmonk-ops/abtest": resolve(root, "packages/abtest/src/index.ts"),
			"@listmonk-ops/automation": resolve(
				root,
				"packages/automation/src/index.ts",
			),
			"@listmonk-ops/common": resolve(root, "packages/common/src/index.ts"),
			"@listmonk-ops/openapi": resolve(root, "packages/openapi/index.ts"),
			"@listmonk-ops/operations": resolve(
				root,
				"packages/operations/src/index.ts",
			),
			"@listmonk-ops/operations/specs": resolve(
				root,
				"packages/operations/src/specs/index.ts",
			),
		},
		logLevel: "silent",
	});
	await import(pathToFileURL(output).href);
} finally {
	await rm(temporaryDirectory, { recursive: true, force: true });
}
