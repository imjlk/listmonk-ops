import { existsSync } from "node:fs";
import {
	chmod,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { expect, test } from "bun:test";

const publisher = resolve(import.meta.dir, "sampo-publish.sh");

// Stands in for `sampo publish`: records its arguments and the npm user
// config it received, including the config file's permission bits while the
// wrapper still holds it, then exits with SAMPO_STUB_EXIT.
const sampoStub = [
	"#!/usr/bin/env bash",
	"set -euo pipefail",
	'printf "args=%s\\n" "$*" >>"$SAMPO_STUB_LOG"',
	'printf "userconfig=%s\\n" "${NPM_CONFIG_USERCONFIG:-}" >>"$SAMPO_STUB_LOG"',
	'if [[ -n "${NPM_CONFIG_USERCONFIG:-}" ]]; then',
	'  printf "mode=%s\\n" "$(ls -l "$NPM_CONFIG_USERCONFIG" | cut -c1-10)" >>"$SAMPO_STUB_LOG"',
	'  printf "content=%s\\n" "$(cat "$NPM_CONFIG_USERCONFIG")" >>"$SAMPO_STUB_LOG"',
	"fi",
	'exit "${SAMPO_STUB_EXIT:-0}"',
];

async function runPublisher(
	directory: string,
	options: { token?: string; stubExit?: number } = {},
) {
	const stubDirectory = join(directory, "bin");
	const temporaryDirectory = join(directory, "tmp");
	const log = join(directory, "sampo.log");
	await mkdir(stubDirectory, { recursive: true });
	await mkdir(temporaryDirectory, { recursive: true });
	await writeFile(join(stubDirectory, "sampo"), `${sampoStub.join("\n")}\n`);
	await chmod(join(stubDirectory, "sampo"), 0o755);
	await writeFile(log, "");

	const env: Record<string, string | undefined> = {
		...process.env,
		PATH: `${stubDirectory}${delimiter}${process.env.PATH ?? ""}`,
		SAMPO_STUB_EXIT: String(options.stubExit ?? 0),
		SAMPO_STUB_LOG: log,
		TMPDIR: temporaryDirectory,
	};
	delete env.NODE_AUTH_TOKEN;
	delete env.NPM_PUBLISH_TOKEN;
	delete env.NPM_CONFIG_USERCONFIG;
	if (options.token !== undefined) {
		env.NPM_PUBLISH_TOKEN = options.token;
	}

	const result = Bun.spawnSync(
		["bash", publisher, "--dry-run", "--", "--access", "public"],
		{ env, stderr: "pipe", stdout: "pipe" },
	);
	const recorded = new Map(
		(await readFile(log, "utf8"))
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				const separator = line.indexOf("=");
				return [line.slice(0, separator), line.slice(separator + 1)] as const;
			}),
	);
	const userconfig = recorded.get("userconfig") ?? "";
	return {
		temporaryDirectory,
		exitCode: result.exitCode,
		stderr: new TextDecoder().decode(result.stderr),
		recorded,
		userconfig,
		// The EXIT trap must remove the token file wherever mktemp put it.
		userconfigLeftBehind: userconfig !== "" && existsSync(userconfig),
		leftovers: await readdir(temporaryDirectory),
	};
}

async function withDirectory(
	run: (directory: string) => Promise<void>,
): Promise<void> {
	const directory = await mkdtemp(
		join(tmpdir(), "listmonk-ops-sampo-publish-"),
	);
	try {
		await run(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

test("publisher writes a token to a private temporary npm config and removes it", async () => {
	await withDirectory(async (directory) => {
		const run = await runPublisher(directory, { token: "test-publish-token" });

		expect(run.exitCode, run.stderr).toBe(0);
		expect(run.recorded.get("args")).toBe(
			"publish --dry-run -- --access public",
		);
		// A portable mktemp template under TMPDIR; GNU mktemp rejects the
		// `mktemp -t <prefix>` form that has no trailing X's.
		expect(dirname(run.userconfig)).toBe(run.temporaryDirectory);
		expect(basename(run.userconfig)).toMatch(
			/^listmonk-ops-npmrc\.[A-Za-z0-9]{6}$/,
		);
		expect(run.recorded.get("mode")).toBe("-rw-------");
		expect(run.recorded.get("content")).toBe(
			"//registry.npmjs.org/:_authToken=test-publish-token",
		);
		expect(run.userconfigLeftBehind).toBe(false);
		expect(run.leftovers).toEqual([]);
	});
});

test("publisher removes the token config and keeps the exit code when sampo fails", async () => {
	await withDirectory(async (directory) => {
		const run = await runPublisher(directory, {
			token: "test-publish-token",
			stubExit: 3,
		});

		expect(run.exitCode).toBe(3);
		expect(basename(run.userconfig)).toStartWith("listmonk-ops-npmrc.");
		expect(run.userconfigLeftBehind).toBe(false);
		expect(run.leftovers).toEqual([]);
	});
});

test("publisher leaves npm configuration alone without a token", async () => {
	await withDirectory(async (directory) => {
		const run = await runPublisher(directory);

		expect(run.exitCode, run.stderr).toBe(0);
		expect(run.recorded.get("args")).toBe(
			"publish --dry-run -- --access public",
		);
		expect(run.userconfig).toBe("");
		expect(run.leftovers).toEqual([]);
	});
});
