import { describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json" with { type: "json" };

const CLI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_ENTRY = resolve(CLI_DIR, "src/index.ts");

type CliResult = {
	exitCode: number;
	output: string;
};

function runCli(args: string[]): CliResult {
	const executable = process.env.CLI_TEST_EXECUTABLE?.trim();
	const command = executable
		? [executable, ...args]
		: ["bun", SOURCE_ENTRY, ...args];
	const result = Bun.spawnSync(command, {
		cwd: CLI_DIR,
		env: {
			...process.env,
			BUN_FORCE_COLOR: "0",
			LISTMONK_API_TOKEN: "",
		},
		stdout: "pipe",
		stderr: "pipe",
	});

	return {
		exitCode: result.exitCode,
		output: `${result.stdout.toString()}${result.stderr.toString()}`.trim(),
	};
}

describe("CLI contract", () => {
	test("shows the stable top-level command tree", () => {
		const result = runCli(["--help"]);

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("listmonk-cli");
		for (const command of [
			"status",
			"examples",
			"campaigns",
			"lists",
			"subscribers",
			"templates",
			"tx",
			"abtest",
			"ops",
		]) {
			expect(result.output).toContain(command);
		}
		expect(result.output).toMatch(/completions?|complete/);
	});

	test("prints the package version", () => {
		const result = runCli(["--version"]);

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain(packageJson.version);
	});

	test("renders nested group and leaf help", () => {
		const group = runCli(["campaigns", "--help"]);
		const leaf = runCli(["campaigns", "get", "--help"]);

		expect(group.exitCode).toBe(0);
		expect(group.output).toContain("list");
		expect(group.output).toContain("get");
		expect(leaf.exitCode).toBe(0);
		expect(leaf.output).toContain("--id");
	});

	test("exposes list pagination flags", () => {
		const result = runCli(["lists", "list", "--help"]);

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("--page");
		expect(result.output).toContain("--per-page");
	});

	test("exposes subscriber-list CRUD commands", () => {
		const group = runCli(["lists", "--help"]);
		const create = runCli(["lists", "create", "--help"]);
		const update = runCli(["lists", "update", "--help"]);
		const remove = runCli(["lists", "delete", "--help"]);

		expect(group.exitCode).toBe(0);
		for (const command of ["list", "get", "create", "update", "delete"]) {
			expect(group.output).toContain(command);
		}
		expect(create.output).toContain("--name");
		expect(update.output).toContain("--id");
		expect(remove.output).toContain("--id");
	});

	test("exposes the shared transactional payload flags", () => {
		const result = runCli(["tx", "send", "--help"]);

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("--template-id");
		expect(result.output).toContain("--subscriber-email");
		expect(result.output).toContain("--subscriber-id");
		expect(result.output).toContain("--content-type");
		expect(result.output).toContain("--headers");
	});

	test("accepts documented numeric list page sizes", () => {
		const result = runCli(["lists", "list", "--per-page", "5000"]);

		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain("Missing LISTMONK_API_TOKEN");
		expect(result.output).not.toMatch(/less than|maximum|too big/i);
	});

	test("rejects missing and out-of-range required options", () => {
		const missing = runCli(["campaigns", "get"]);
		const invalid = runCli(["campaigns", "get", "--id", "0"]);

		expect(missing.exitCode).not.toBe(0);
		expect(missing.output).toContain("id");
		expect(invalid.exitCode).not.toBe(0);
		expect(invalid.output).toMatch(/id|greater|small|positive/i);
	});

	test("rejects unknown commands", () => {
		const result = runCli(["not-a-command"]);

		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain("not-a-command");
	});

	test("keeps the legacy completions command working", () => {
		const result = runCli(["completions", "zsh"]);

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("listmonk-cli");
		expect(result.output.toLowerCase()).toContain("zsh");
	});

	test("generates completion from the canonical command", () => {
		const result = runCli(["complete", "zsh"]);

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("#compdef listmonk-cli");
	});

	test("accepts legacy explicit boolean values", () => {
		const result = runCli([
			"ops",
			"guard",
			"--campaign-id",
			"1",
			"--pause-on-breach",
			"true",
		]);

		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain("Deliverability guard failed");
		expect(result.output).toContain("Missing LISTMONK_API_TOKEN");
		expect(result.output).not.toMatch(/unknown|unexpected/i);
	});

	test("accepts Gunshi negated boolean options", () => {
		const result = runCli([
			"ops",
			"guard",
			"--campaign-id",
			"1",
			"--no-pause-on-breach",
		]);

		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain("Missing LISTMONK_API_TOKEN");
		expect(result.output).not.toMatch(/unknown|unexpected/i);
	});
});
