import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binary = process.env.CLI_TEST_EXECUTABLE?.trim();
const directories: string[] = [];

afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

async function runBinaryIn(workingDirectory: string, args: string[]) {
	// A minimal environment keeps developer shell settings (which Bun would
	// prefer over `.env`) from masking what the binary reads from the directory.
	const child = Bun.spawn([resolve(cliDirectory, binary ?? ""), ...args], {
		cwd: workingDirectory,
		env: {
			PATH: process.env.PATH ?? "",
			HOME: join(workingDirectory, "home"),
			BUN_FORCE_COLOR: "0",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout, stderr, exitCode };
}

// Only the standalone binary controls runtime autoload. `bun src/index.ts` and
// the npm entry run under the caller's Bun, which honors the working
// directory's bunfig.toml by design; the README documents that trust boundary.
describe.skipIf(!binary)("standalone binary working-directory configuration", () => {
	test("never executes a bunfig.toml preload from the working directory", async () => {
		const workingDirectory = await mkdtemp(join(tmpdir(), "cli-bunfig-preload-"));
		directories.push(workingDirectory);
		const marker = join(workingDirectory, "preload-executed");
		await writeFile(
			join(workingDirectory, "bunfig.toml"),
			'preload = ["./preload.js"]\n',
		);
		await writeFile(
			join(workingDirectory, "preload.js"),
			`require("node:fs").writeFileSync(${JSON.stringify(marker)}, "executed");\n`,
		);

		const result = await runBinaryIn(workingDirectory, [
			"operations",
			"--family",
			"lists",
		]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('"family": "lists"');
		expect(await Bun.file(marker).exists()).toBe(false);
	});

	test("keeps the documented .env loading from the working directory", async () => {
		const workingDirectory = await mkdtemp(join(tmpdir(), "cli-dotenv-"));
		directories.push(workingDirectory);
		await writeFile(
			join(workingDirectory, ".env"),
			"LISTMONK_API_URL=https://dotenv.example.test\nLISTMONK_USERNAME=dotenv-user\n",
		);

		const result = await runBinaryIn(workingDirectory, [
			"config",
			"show",
			"--format=json",
		]);

		expect(result.exitCode).toBe(0);
		const output = JSON.parse(result.stdout);
		expect(output.baseUrl).toBe("https://dotenv.example.test/api");
		expect(output.username).toBe("dotenv-user");
		expect(output.sources.baseUrl).toEqual({
			kind: "environment",
			name: "LISTMONK_API_URL",
		});
	});
});
