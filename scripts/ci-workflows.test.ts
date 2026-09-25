import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

test("CI reuses the full build without removing binary or integration coverage", () => {
	const workflow = read(".github/workflows/ci.yml");
	expect(workflow.indexOf("run: bun run build")).toBeLessThan(
		workflow.indexOf("run: bun run test:built"),
	);
	expect(workflow).toContain("bun run --cwd apps/cli test:binary");
	expect(workflow).toContain("outbound-webhook-postgres.test.ts");
	expect(workflow).toContain("sequence-postgres.test.ts");
	expect(workflow).toContain("bun run test:e2e");
	expect(workflow).toContain(
		"cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
	);
});

test("built tests preserve per-package isolation and do not invoke build hooks", () => {
	const script = read("scripts/test-built-workspaces.sh");
	expect(script).toContain("common openapi operations automation abtest");
	expect(script).toContain("cd apps/cli && bun test tests");
	expect(script).toContain("cd packages/mcp && bun test tests/unit");
	expect(script).toContain("bun test scripts");
	expect(script).not.toMatch(/^\s*bun run.*build/m);
	expect(script).not.toMatch(/^\s*bun run.*test/m);
	expect(script).toContain("Missing build for");
});

test("diagnostic and intermediate artifacts have bounded retention", () => {
	expect(read(".github/workflows/ci.yml")).toMatch(
		/Upload smoke artifacts on failure\s+if: failure\(\)/,
	);
	expect(read(".github/workflows/ci.yml")).toContain("retention-days: 7");
	expect(read(".github/workflows/cli-github-release.yml")).toContain(
		"retention-days: 1",
	);
	expect(read(".github/workflows/cli-github-release.yml")).toContain(
		"release-assets/checksums.txt",
	);
});
