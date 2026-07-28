import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { $ } from "bun";
import { describe, expect, test } from "bun:test";

const generator = resolve(import.meta.dir, "generate-renovate-changeset.sh");

function run(command: string[], cwd: string): Promise<string> {
	return $`${command}`.cwd(cwd).text();
}

describe("Renovate changeset generator", () => {
	test("maps releasable workspace changes to their Sampo packages", async () => {
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
			const productSchemaDirectory = join(
				repository,
				"packages",
				"product-schema",
			);
			await mkdir(productSchemaDirectory, { recursive: true });
			const productSchemaFile = join(
				productSchemaDirectory,
				"package.json",
			);
			await writeFile(productSchemaFile, '{"version":"0.0.0"}\n');
			await run(["git", "add", "."], repository);
			await run(["git", "commit", "-m", "initial"], repository);
			const base = (await run(["git", "rev-parse", "HEAD"], repository)).trim();

			await writeFile(packageFile, '{"version":"0.1.1"}\n');
			await writeFile(productSchemaFile, '{"version":"0.0.1"}\n');
			await run(["git", "add", "."], repository);
			await run(["git", "commit", "-m", "update workspaces"], repository);
			const head = (await run(["git", "rev-parse", "HEAD"], repository)).trim();
			await run(["bash", generator, base, head, "314"], repository);

			const changeset = await readFile(
				join(repository, ".sampo", "changesets", "renovate-pr-314.md"),
				"utf8",
			);
			expect(changeset).toContain(
				"npm/@listmonk-ops/operations: patch (Changed)",
			);
			expect(changeset).toContain(
				"npm/@listmonk-ops/product-schema: patch (Changed)",
			);
		} finally {
			await rm(repository, { recursive: true, force: true });
		}
	});
});
