import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = resolve(CLI_DIR, "dist/bin");
const TARGETS = [
	{ target: "bun-linux-x64", output: "listmonk-cli-linux-x64" },
	{ target: "bun-linux-arm64", output: "listmonk-cli-linux-arm64" },
	{ target: "bun-darwin-arm64", output: "listmonk-cli-darwin-arm64" },
] as const;

// The binary runs in whatever directory an operator happens to be in, so it
// must not read Bun runtime configuration from there. A bunfig.toml can
// `preload` arbitrary code, and the CLI has no use for one. `.env` loading is
// documented behavior for both executables, so it stays enabled explicitly and
// the README documents that trust boundary. Runtime tsconfig.json and
// package.json autoload are already off by default; pin them so a future Bun
// default cannot silently widen what the binary reads from the working directory.
const RUNTIME_AUTOLOAD_FLAGS = [
	"--no-compile-autoload-bunfig",
	"--compile-autoload-dotenv",
	"--no-compile-autoload-tsconfig",
	"--no-compile-autoload-package-json",
] as const;

mkdirSync(DIST_DIR, { recursive: true });

function build(target: string | undefined, outputPath: string): void {
	const command = [
		"bun",
		"build",
		"src/index.ts",
		"--compile",
		"--minify",
		...RUNTIME_AUTOLOAD_FLAGS,
		`--outfile=${outputPath}`,
	];
	if (target) {
		command.push(`--target=${target}`);
	}

	const result = Bun.spawnSync(command, {
		cwd: CLI_DIR,
		stdout: "inherit",
		stderr: "inherit",
	});
	if (result.exitCode !== 0) {
		throw new Error(
			`Failed to build CLI binary${target ? ` for ${target}` : ""}`,
		);
	}
}

if (process.argv.includes("--all")) {
	for (const item of TARGETS) {
		build(item.target, resolve(DIST_DIR, item.output));
	}
} else {
	const target = process.env.BUN_BUILD_TARGET?.trim() || undefined;
	const outputPath = process.env.CLI_BINARY_OUTPUT?.trim()
		? resolve(CLI_DIR, process.env.CLI_BINARY_OUTPUT)
		: resolve(DIST_DIR, "listmonk-cli");
	build(target, outputPath);
}
