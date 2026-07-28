import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { $ } from "bun";
import { describe, expect, test } from "bun:test";

const checker = resolve(import.meta.dir, "check-sampo-changeset.sh");

function run(command: string[], cwd: string): Promise<string> {
	return $`${command}`.cwd(cwd).text();
}

async function runCheck(cwd: string, base: string) {
	const child = Bun.spawn(["bash", checker, base], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

describe("Sampo changeset guard", () => {
	test("requires an operations changeset for specs-only changes", async () => {
		const repository = await mkdtemp(
			join(tmpdir(), "listmonk-ops-sampo-check-"),
		);
		try {
			await run(["git", "init", "--initial-branch=main"], repository);
			await run(["git", "config", "user.name", "Test"], repository);
			await run(
				["git", "config", "user.email", "test@example.com"],
				repository,
			);
			const packageDirectory = join(
				repository,
				"packages",
				"operations",
				"src",
				"specs",
			);
			await mkdir(packageDirectory, { recursive: true });
			const packageFile = join(packageDirectory, "operation.ts");
			await writeFile(packageFile, "export const version = 0;\n");
			await run(["git", "add", "."], repository);
			await run(["git", "commit", "-m", "initial"], repository);
			const base = (await run(["git", "rev-parse", "HEAD"], repository)).trim();

			await writeFile(packageFile, "export const version = 1;\n");
			const missing = await runCheck(repository, base);
			expect(missing.exitCode).toBe(1);
			expect(missing.stdout).toContain(
				"packages/operations/src/specs/operation.ts",
			);

			const changesetDirectory = join(repository, ".sampo", "changesets");
			await mkdir(changesetDirectory, { recursive: true });
			await writeFile(
				join(changesetDirectory, "operations-specs.md"),
				"---\nnpm/@listmonk-ops/operations: patch (Changed)\n---\n",
			);
			const accepted = await runCheck(repository, base);
			expect(accepted).toEqual(
				expect.objectContaining({
					exitCode: 0,
					stderr: "",
				}),
			);
			expect(accepted.stdout).toContain("Changeset file detected");
		} finally {
			await rm(repository, { recursive: true, force: true });
		}
	});
});
