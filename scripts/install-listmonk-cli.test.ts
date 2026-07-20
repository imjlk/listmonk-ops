import {
	chmod,
	mkdtemp,
	mkdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { expect, test } from "bun:test";

const installer = resolve(import.meta.dir, "install-listmonk-cli.sh");
const expectedDownloadUrl =
	"https://github.com/imjlk/listmonk-ops/releases/download/%40listmonk-ops%2Fcli-v0.3.0/listmonk-cli-linux-x64.tar.gz";

async function writeExecutable(path: string, lines: string[]): Promise<void> {
	await writeFile(path, `${lines.join("\n")}\n`);
	await chmod(path, 0o755);
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
				'if [[ "$url" == *"/%40listmonk-ops%2Fcli-v0.3.0/"* ]]; then',
				'  : > "$out"',
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
				"printf '#!/usr/bin/env bash\\n' > \"$destination/listmonk-cli-linux-x64\"",
				'chmod +x "$destination/listmonk-cli-linux-x64"',
			]);

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
				`${expectedDownloadUrl}\n`,
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
