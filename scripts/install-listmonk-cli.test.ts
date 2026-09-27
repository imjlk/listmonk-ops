import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
	chmod,
	mkdtemp,
	mkdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { expect, test } from "bun:test";

const installer = resolve(import.meta.dir, "install-listmonk-cli.sh");
const linuxAssetName = "listmonk-cli-linux-x64.tar.gz";
const expectedDownloadUrl =
	`https://github.com/imjlk/listmonk-ops/releases/download/%40listmonk-ops%2Fcli-v0.3.0/${linuxAssetName}`;
const rosettaAssetName = "listmonk-cli-darwin-arm64.tar.gz";
const expectedRosettaDownloadUrl =
	`https://github.com/imjlk/listmonk-ops/releases/download/%40listmonk-ops%2Fcli-v0.3.0/${rosettaAssetName}`;
const expectedChecksumsUrl =
	"https://github.com/imjlk/listmonk-ops/releases/download/%40listmonk-ops%2Fcli-v0.3.0/checksums.txt";

async function writeExecutable(path: string, lines: string[]): Promise<void> {
	await writeFile(path, `${lines.join("\n")}\n`);
	await chmod(path, 0o755);
}

function archiveBytes(assetName: string): string {
	return `release archive ${assetName}\n`;
}

function sha256(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

// Mirrors the release workflow's `sha256sum *.tar.gz > checksums.txt`.
function releaseChecksums(assetName: string): string {
	return `${sha256("other archive")}  listmonk-cli-linux-arm64.tar.gz\n${sha256(archiveBytes(assetName))}  ${assetName}\n`;
}

// Serves the release assets written under `<stubDirectory>/../release` for the
// @listmonk-ops/cli-v0.3.0 tag. `checksums: null` publishes no checksums.txt.
async function writeDownloadStubs(
	stubDirectory: string,
	assetName: string,
	options: { checksums?: string | null } = {},
): Promise<void> {
	const binaryName = assetName.slice(0, -".tar.gz".length);
	const releaseDirectory = join(stubDirectory, "..", "release");
	await mkdir(releaseDirectory, { recursive: true });
	await writeFile(join(releaseDirectory, assetName), archiveBytes(assetName));
	const checksums =
		options.checksums === undefined
			? releaseChecksums(assetName)
			: options.checksums;
	if (checksums !== null) {
		await writeFile(join(releaseDirectory, "checksums.txt"), checksums);
	}
	await writeExecutable(join(stubDirectory, "curl"), [
		"#!/usr/bin/env bash",
		"set -euo pipefail",
		'url=""',
		'out=""',
		"while [[ $# -gt 0 ]]; do",
		'  case "$1" in',
		'    -o) out="$2"; shift 2 ;;',
		'    http*) url="$1"; shift ;;',
		"    *) shift ;;",
		"  esac",
		"done",
		'printf \'%s\\n\' "$url" >> "$CURL_LOG"',
		`release_directory='${releaseDirectory.replaceAll("'", "'\\''")}'`,
		'if [[ "$url" == */%40listmonk-ops%2Fcli-v0.3.0/* && -f "$release_directory/${url##*/}" ]]; then',
		'  cp "$release_directory/${url##*/}" "$out"',
		"  exit 0",
		"fi",
		"exit 22",
	]);
	await writeExecutable(join(stubDirectory, "tar"), [
		"#!/usr/bin/env bash",
		"set -euo pipefail",
		'destination=""',
		"while [[ $# -gt 0 ]]; do",
		'  if [[ "$1" == "-C" ]]; then',
		'    destination="$2"',
		"    shift 2",
		"  else",
		"    shift",
		"  fi",
		"done",
		'test -n "$destination"',
		`printf '#!/usr/bin/env bash\\n' > "$destination/${binaryName}"`,
		`chmod +x "$destination/${binaryName}"`,
	]);
}

for (const requestedVersion of ["0.3.0", "v0.3.0"]) {
	test(`CLI installer resolves ${requestedVersion} to the scoped Sampo tag`, async () => {
		const directory = await mkdtemp(
			join(tmpdir(), "listmonk-cli-installer-"),
		);
		try {
			const stubDirectory = join(directory, "bin");
			const installDirectory = join(directory, "install");
			const curlLog = join(directory, "curl.log");
			await mkdir(stubDirectory, { recursive: true });

			await writeExecutable(join(stubDirectory, "uname"), [
				"#!/usr/bin/env bash",
				"set -euo pipefail",
				'case "${1:-}" in',
				'  -s) echo "Linux" ;;',
				'  -m) echo "x86_64" ;;',
				"  *) exit 1 ;;",
				"esac",
			]);
			await writeDownloadStubs(stubDirectory, linuxAssetName);

			const result = Bun.spawnSync(
				[
					"bash",
					installer,
					"--version",
					requestedVersion,
					"--install-dir",
					installDirectory,
				],
				{
					env: {
						...process.env,
						CURL_LOG: curlLog,
						PATH: `${stubDirectory}${delimiter}${process.env.PATH ?? ""}`,
					},
					stderr: "pipe",
					stdout: "pipe",
				},
			);
			const stderr = new TextDecoder().decode(result.stderr);
			const stdout = new TextDecoder().decode(result.stdout);

			expect(result.exitCode, stderr).toBe(0);
			expect(await readFile(curlLog, "utf8")).toBe(
				`${expectedDownloadUrl}\n${expectedChecksumsUrl}\n`,
			);
			expect(stdout).toContain(
				`Verified ${linuxAssetName} SHA-256 against checksums.txt`,
			);
			expect(stdout).toContain("@listmonk-ops/cli-v0.3.0");
			expect(
				await readFile(join(installDirectory, "listmonk-cli"), "utf8"),
			).toBe("#!/usr/bin/env bash\n");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
}

for (const [label, args, message] of [
	["--version at the end", ["--version"], "Option --version requires a value"],
	[
		"--install-dir at the end",
		["--install-dir"],
		"Option --install-dir requires a value",
	],
	["--repo at the end", ["--repo"], "Option --repo requires a value"],
	[
		"an empty --version",
		["--version", ""],
		"Option --version requires a value",
	],
	[
		"--install-dir followed by an option",
		["--install-dir", "--version", "0.3.0"],
		"Option --install-dir requires a value",
	],
	["an unknown option", ["--bogus"], "Unknown option: --bogus"],
] as const) {
	test(`CLI installer rejects ${label} on stderr`, async () => {
		const directory = await mkdtemp(join(tmpdir(), "listmonk-cli-installer-"));
		try {
			const stubDirectory = join(directory, "bin");
			const curlLog = join(directory, "curl.log");
			await mkdir(stubDirectory, { recursive: true });
			await writeFile(curlLog, "");
			await writeExecutable(join(stubDirectory, "curl"), [
				"#!/usr/bin/env bash",
				'printf "called\\n" >> "$CURL_LOG"',
				"exit 99",
			]);

			const result = Bun.spawnSync(["bash", installer, ...args], {
				env: {
					...process.env,
					CURL_LOG: curlLog,
					PATH: `${stubDirectory}${delimiter}${process.env.PATH ?? ""}`,
				},
				stderr: "pipe",
				stdout: "pipe",
			});
			const stderr = new TextDecoder().decode(result.stderr);

			expect(result.exitCode).toBe(1);
			expect(stderr).toContain(message);
			expect(stderr).toContain("Usage:");
			expect(new TextDecoder().decode(result.stdout)).toBe("");
			expect(await readFile(curlLog, "utf8")).toBe("");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
}

test("CLI installer rejects macOS Intel before downloading an asset", async () => {
	const directory = await mkdtemp(join(tmpdir(), "listmonk-cli-installer-"));
	try {
		const stubDirectory = join(directory, "bin");
		const curlLog = join(directory, "curl.log");
		await mkdir(stubDirectory, { recursive: true });
		await writeFile(curlLog, "");

		await writeExecutable(join(stubDirectory, "uname"), [
			"#!/usr/bin/env bash",
			"set -euo pipefail",
			'case "${1:-}" in',
			'  -s) echo "Darwin" ;;',
			'  -m) echo "x86_64" ;;',
			"  *) exit 1 ;;",
			"esac",
		]);
		await writeExecutable(join(stubDirectory, "curl"), [
			"#!/usr/bin/env bash",
			"set -euo pipefail",
			'printf "called\\n" >> "$CURL_LOG"',
			"exit 99",
		]);
		await writeExecutable(join(stubDirectory, "sysctl"), [
			"#!/usr/bin/env bash",
			"set -euo pipefail",
			'[[ "$*" == "-in sysctl.proc_translated" ]]',
			'echo "0"',
		]);

		const result = Bun.spawnSync(["bash", installer], {
			env: {
				...process.env,
				CURL_LOG: curlLog,
				PATH: `${stubDirectory}${delimiter}${process.env.PATH ?? ""}`,
			},
			stderr: "pipe",
			stdout: "pipe",
		});
		const stderr = new TextDecoder().decode(result.stderr);

		expect(result.exitCode).toBe(1);
		expect(stderr).toContain("Unsupported platform: macOS Intel");
		expect(await readFile(curlLog, "utf8")).toBe("");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("CLI installer selects the arm64 asset under Rosetta", async () => {
	const directory = await mkdtemp(join(tmpdir(), "listmonk-cli-installer-"));
	try {
		const stubDirectory = join(directory, "bin");
		const installDirectory = join(directory, "install");
		const curlLog = join(directory, "curl.log");
		await mkdir(stubDirectory, { recursive: true });

		await writeExecutable(join(stubDirectory, "uname"), [
			"#!/usr/bin/env bash",
			"set -euo pipefail",
			'case "${1:-}" in',
			'  -s) echo "Darwin" ;;',
			'  -m) echo "x86_64" ;;',
			"  *) exit 1 ;;",
			"esac",
		]);
		await writeExecutable(join(stubDirectory, "sysctl"), [
			"#!/usr/bin/env bash",
			"set -euo pipefail",
			'[[ "$*" == "-in sysctl.proc_translated" ]]',
			'echo "1"',
		]);
		await writeDownloadStubs(stubDirectory, rosettaAssetName);

		const result = Bun.spawnSync(
			[
				"bash",
				installer,
				"--version",
				"0.3.0",
				"--install-dir",
				installDirectory,
			],
			{
				env: {
					...process.env,
					CURL_LOG: curlLog,
					PATH: `${stubDirectory}${delimiter}${process.env.PATH ?? ""}`,
				},
				stderr: "pipe",
				stdout: "pipe",
			},
		);
		const stderr = new TextDecoder().decode(result.stderr);

		expect(result.exitCode, stderr).toBe(0);
		expect(await readFile(curlLog, "utf8")).toBe(
			`${expectedRosettaDownloadUrl}\n${expectedChecksumsUrl}\n`,
		);
		expect(
			await readFile(join(installDirectory, "listmonk-cli"), "utf8"),
		).toBe("#!/usr/bin/env bash\n");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

async function runLinuxInstall(
	options: {
		checksums?: string | null;
		sha256Tool?: "system" | "shasum-only" | "none";
	} = {},
) {
	const directory = await mkdtemp(join(tmpdir(), "listmonk-cli-installer-"));
	const stubDirectory = join(directory, "bin");
	const installDirectory = join(directory, "install");
	const curlLog = join(directory, "curl.log");
	const shasumLog = join(directory, "shasum.log");
	await mkdir(stubDirectory, { recursive: true });
	await writeExecutable(join(stubDirectory, "uname"), [
		"#!/usr/bin/env bash",
		"set -euo pipefail",
		'case "${1:-}" in',
		'  -s) echo "Linux" ;;',
		'  -m) echo "x86_64" ;;',
		"  *) exit 1 ;;",
		"esac",
	]);
	await writeDownloadStubs(stubDirectory, linuxAssetName, {
		checksums: options.checksums,
	});

	let path = `${stubDirectory}${delimiter}${process.env.PATH ?? ""}`;
	if (options.sha256Tool === "shasum-only" || options.sha256Tool === "none") {
		// Hide the host's sha256sum/shasum behind a PATH of only the tools the
		// installer and its stubs need.
		const toolDirectory = join(directory, "tools");
		await mkdir(toolDirectory);
		for (const tool of [
			"bash",
			"cat",
			"chmod",
			"cp",
			"head",
			"install",
			"mkdir",
			"mktemp",
			"rm",
			"sed",
			"tr",
		]) {
			const target = Bun.which(tool);
			if (!target) throw new Error(`${tool} is required for this test`);
			await symlink(target, join(toolDirectory, tool));
		}
		if (options.sha256Tool === "shasum-only") {
			await writeExecutable(join(stubDirectory, "shasum"), [
				"#!/usr/bin/env bash",
				"set -euo pipefail",
				'printf \'%s\\n\' "$*" >> "$SHASUM_LOG"',
				'[[ "$*" == "-a 256" ]]',
				"cat >/dev/null",
				`printf '%s  -\\n' '${sha256(archiveBytes(linuxAssetName))}'`,
			]);
		}
		path = `${stubDirectory}${delimiter}${toolDirectory}`;
	}

	const result = Bun.spawnSync(
		[
			Bun.which("bash") ?? "bash",
			installer,
			"--version",
			"0.3.0",
			"--install-dir",
			installDirectory,
		],
		{
			env: {
				...process.env,
				CURL_LOG: curlLog,
				SHASUM_LOG: shasumLog,
				PATH: path,
			},
			stderr: "pipe",
			stdout: "pipe",
		},
	);
	return {
		directory,
		installDirectory,
		curlLog,
		shasumLog,
		exitCode: result.exitCode,
		stdout: new TextDecoder().decode(result.stdout),
		stderr: new TextDecoder().decode(result.stderr),
	};
}

for (const [label, checksums, message] of [
	[
		"an archive whose digest does not match",
		`${sha256("tampered archive")}  ${linuxAssetName}\n`,
		`Checksum mismatch for ${linuxAssetName}`,
	],
	["a release without checksums.txt", null, "Could not download checksums.txt"],
	[
		"checksums.txt without an entry for the asset",
		`${sha256("other archive")}  listmonk-cli-linux-arm64.tar.gz\n`,
		`has no SHA-256 entry for ${linuxAssetName}`,
	],
	[
		"a malformed checksum entry",
		`not-a-sha256-digest  ${linuxAssetName}\n`,
		`has no SHA-256 entry for ${linuxAssetName}`,
	],
] as const) {
	test(`CLI installer refuses ${label} and installs nothing`, async () => {
		const run = await runLinuxInstall({ checksums });
		try {
			expect(run.exitCode).toBe(1);
			expect(run.stderr).toContain(message);
			expect(run.stderr).toContain("refusing to install");
			expect(existsSync(run.installDirectory)).toBe(false);
			expect(await readFile(run.curlLog, "utf8")).toBe(
				`${expectedDownloadUrl}\n${expectedChecksumsUrl}\n`,
			);
		} finally {
			await rm(run.directory, { recursive: true, force: true });
		}
	});
}

for (const [label, checksums] of [
	[
		"binary-mode, uppercase, CRLF checksum entries",
		`${sha256("other archive")}  listmonk-cli-linux-arm64.tar.gz\r\n${sha256(archiveBytes(linuxAssetName)).toUpperCase()} *${linuxAssetName}\r\n`,
	],
	[
		"a final checksum entry without a trailing newline",
		`${sha256("other archive")}  listmonk-cli-linux-arm64.tar.gz\n${sha256(archiveBytes(linuxAssetName))}  ${linuxAssetName}`,
	],
] as const) {
	test(`CLI installer accepts ${label}`, async () => {
		const run = await runLinuxInstall({ checksums });
		try {
			expect(run.exitCode, run.stderr).toBe(0);
			expect(
				await readFile(join(run.installDirectory, "listmonk-cli"), "utf8"),
			).toBe("#!/usr/bin/env bash\n");
		} finally {
			await rm(run.directory, { recursive: true, force: true });
		}
	});
}

test("CLI installer verifies with shasum -a 256 when sha256sum is missing", async () => {
	const run = await runLinuxInstall({ sha256Tool: "shasum-only" });
	try {
		expect(run.exitCode, run.stderr).toBe(0);
		expect(await readFile(run.shasumLog, "utf8")).toBe("-a 256\n");
		expect(
			await readFile(join(run.installDirectory, "listmonk-cli"), "utf8"),
		).toBe("#!/usr/bin/env bash\n");
	} finally {
		await rm(run.directory, { recursive: true, force: true });
	}
});

test("CLI releases publish the checksums.txt the installer verifies", async () => {
	const workflow = await readFile(
		resolve(import.meta.dir, "../.github/workflows/cli-github-release.yml"),
		"utf8",
	);
	expect(workflow).toContain("sha256sum *.tar.gz > checksums.txt");
	expect(workflow).toContain("release-assets/checksums.txt");
});

test("CLI installer fails closed without a SHA-256 tool", async () => {
	const run = await runLinuxInstall({ sha256Tool: "none" });
	try {
		expect(run.exitCode).toBe(1);
		expect(run.stderr).toContain("Neither sha256sum nor shasum is available");
		expect(existsSync(run.installDirectory)).toBe(false);
	} finally {
		await rm(run.directory, { recursive: true, force: true });
	}
});
