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
		"group: ci-${{ github.event.pull_request.number || github.run_id }}",
	);
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

test("the local stack pins every service image to an explicit tag", () => {
	// Renovate does not manage docker-compose.yml, so a floating tag would
	// silently change the CI integration stack.
	const compose = Bun.YAML.parse(read("docker-compose.yml")) as {
		services: Record<string, { image?: unknown }>;
	};
	const services = Object.entries(compose.services);
	expect(services.length).toBeGreaterThan(0);
	for (const [name, service] of services) {
		expect(service.image, name).toMatch(
			/^[^\s:@]+:\w[\w.-]*(@sha256:[a-f0-9]{64})?$/,
		);
		expect(service.image, name).not.toMatch(/:latest$/);
	}
});

test("every CI job has a bounded timeout", () => {
	// Without timeout-minutes a hung step holds a runner for GitHub's six-hour
	// default. Both jobs usually finish in about seven minutes.
	const workflow = Bun.YAML.parse(read(".github/workflows/ci.yml")) as {
		jobs: Record<string, { "timeout-minutes"?: unknown }>;
	};
	const jobs = Object.entries(workflow.jobs);
	expect(jobs.map(([name]) => name)).toEqual(
		expect.arrayContaining(["build-and-test", "local-stack-smoke"]),
	);
	for (const [name, job] of jobs) {
		const timeout = job["timeout-minutes"];
		expect(Number.isInteger(timeout), name).toBe(true);
		expect(timeout as number, name).toBeGreaterThanOrEqual(10);
		expect(timeout as number, name).toBeLessThanOrEqual(30);
	}
	// A timeout cancels the job rather than failing it, so diagnostics must
	// also run on cancellation to explain a hung local-stack run.
	for (const step of [
		"Upload smoke artifacts on failure",
		"Dump compose logs on failure",
	]) {
		expect(read(".github/workflows/ci.yml")).toContain(
			`- name: ${step}\n        if: failure() || cancelled()\n`,
		);
	}
});
