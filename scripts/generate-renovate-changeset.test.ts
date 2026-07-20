import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const generator = resolve(import.meta.dir, "generate-renovate-changeset.sh");

async function run(command: string[], cwd: string): Promise<string> {
	const process = Bun.spawn(command, {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	if (exitCode !== 0) {
		throw new Error(stderr || `${command.join(" ")} exited with ${exitCode}`);
	}
	return stdout;
}

describe("Renovate changeset generator", () => {
	test("maps operations workspace changes to its Sampo package", async () => {
		const repository = await mkdtemp(
			join(tmpdir(), "listmonk-ops-renovate-"),
		);
		try {
			await run(["git", "init", "--initial-branch=main"], repository);
			await run(["git", "config", "user.name", "Test"], repository);
			await run(
				["git", "config", "user.email", "test@example.com"],
				repository,
			);
			const packageDirectory = join(repository, "packages", "operations");
			await mkdir(packageDirectory, { recursive: true });
			const packageFile = join(packageDirectory, "package.json");
			await writeFile(packageFile, '{"version":"0.1.0"}\n');
			await run(["git", "add", "."], repository);
			await run(["git", "commit", "-m", "initial"], repository);
			const base = (await run(["git", "rev-parse", "HEAD"], repository)).trim();

			await writeFile(packageFile, '{"version":"0.1.1"}\n');
			await run(["git", "add", "."], repository);
			await run(["git", "commit", "-m", "update operations"], repository);
			const head = (await run(["git", "rev-parse", "HEAD"], repository)).trim();
			await run(["bash", generator, base, head, "314"], repository);

			const changeset = await readFile(
				join(repository, ".sampo", "changesets", "renovate-pr-314.md"),
				"utf8",
			);
			expect(changeset).toContain(
				"npm/@listmonk-ops/operations: patch (Changed)",
			);
		} finally {
			await rm(repository, { recursive: true, force: true });
		}
	});
});
