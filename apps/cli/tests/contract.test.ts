import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json" with { type: "json" };

const CLI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_ENTRY = resolve(CLI_DIR, "src/index.ts");
const AUDIT_STORE_DIRECTORY = mkdtempSync(
	join(tmpdir(), "listmonk-ops-cli-contract-"),
);
const AUDIT_STORE_PATH = join(AUDIT_STORE_DIRECTORY, "operation-audit.json");
const WEBHOOK_STORE_PATH = join(
	AUDIT_STORE_DIRECTORY,
	"outbound-webhooks.json",
);
const SEQUENCE_STORE_PATH = join(AUDIT_STORE_DIRECTORY, "sequences.json");

afterAll(() => {
	rmSync(AUDIT_STORE_DIRECTORY, { recursive: true, force: true });
});

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
			LISTMONK_OPS_AUDIT_STORE: AUDIT_STORE_PATH,
			LISTMONK_OPS_WEBHOOK_STORE: WEBHOOK_STORE_PATH,
			LISTMONK_OPS_SEQUENCE_STORE: SEQUENCE_STORE_PATH,
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
			"capabilities",
			"prime",
			"examples",
			"campaigns",
			"lists",
			"media",
			"subscribers",
			"templates",
			"tx",
			"abtest",
			"ops",
			"operations",
			"specs",
			"playbooks",
			"webhooks",
			"sequences",
		]) {
			expect(result.output).toContain(command);
		}
		expect(result.output).toMatch(/completions?|complete/);
	});

	test("manages typed sequence revisions through the shared file store", () => {
		const create = runCli([
			"sequences",
			"create",
			"--name",
			"contract-sequence",
			"--steps",
			'[{"id":"wait","type":"wait","duration_seconds":60},{"id":"stop","type":"stop"}]',
			"--format=json",
		]);
		expect(create.exitCode).toBe(0);
		expect(create.output).toContain('"current_revision": 1');
		const id = create.output.match(
			/"id":\s*"([0-9a-f-]{36})"/i,
		)?.[1];
		expect(id).toBeDefined();

		const update = runCli([
			"sequences",
			"update",
			"--id",
			id!,
			"--steps",
			'[{"id":"stop-v2","type":"stop"}]',
			"--format=json",
		]);
		expect(update.exitCode).toBe(0);
		expect(update.output).toContain('"current_revision": 2');

		const list = runCli(["sequences", "list", "--format=json"]);
		expect(list.exitCode).toBe(0);
		expect(list.output).toContain("contract-sequence");

		const blocked = runCli(["sequences", "delete", "--id", id!]);
		expect(blocked.exitCode).not.toBe(0);
		expect(blocked.output).toContain("requires explicit confirmation");

		const remove = runCli([
			"--confirm",
			"sequences",
			"delete",
			"--id",
			id!,
			"--format=json",
		]);
		expect(remove.exitCode).toBe(0);
		expect(remove.output).toContain('"deleted": true');
	});

	test("manages typed webhook endpoints without persisting secret values in arguments", () => {
		const create = runCli([
			"webhooks",
			"create",
			"--name",
			"contract-endpoint",
			"--url",
			"https://8.8.8.8/hooks",
			"--secret-ref",
			"LISTMONK_OPS_WEBHOOK_SECRET_CONTRACT",
			"--event-filters",
			"operation.*,campaign.finished",
			"--format=json",
		]);
		expect(create.exitCode).toBe(0);
		expect(create.output).toContain('"url_origin": "https://8.8.8.8"');
		expect(create.output).toContain('"secret_reference_configured": true');
		expect(create.output).not.toContain(
			"LISTMONK_OPS_WEBHOOK_SECRET_CONTRACT",
		);
		expect(create.output).not.toContain("https://8.8.8.8/hooks");
		expect(create.output).not.toContain("secret-value");
		const id = create.output.match(
			/"id":\s*"([0-9a-f-]{36})"/i,
		)?.[1];
		expect(id).toBeDefined();

		const list = runCli(["webhooks", "list", "--format=json"]);
		expect(list.exitCode).toBe(0);
		expect(list.output).toContain("contract-endpoint");

		const deliveries = runCli([
			"webhooks",
			"deliveries",
			"list",
			"--format=json",
		]);
		expect(deliveries.exitCode).toBe(0);
		expect(deliveries.output).toContain('"type": "operation.succeeded"');

		const unconfirmed = runCli(["webhooks", "delete", "--id", id!]);
		expect(unconfirmed.exitCode).not.toBe(0);
		expect(unconfirmed.output).toContain("requires explicit confirmation");

		const remove = runCli([
			"--confirm",
			"webhooks",
			"delete",
			"--id",
			id!,
			"--format=json",
		]);
		expect(remove.exitCode).toBe(0);
		expect(remove.output).toContain('"deleted": true');
	});

	test("discovers specs, playbooks, and capabilities without credentials", () => {
		const search = runCli([
			"specs",
			"search",
			"--query",
			"schedule campaign",
			"--format=json",
		]);
		const describe = runCli([
			"specs",
			"describe",
			"--operation",
			"campaigns.schedule",
			"--format=json",
		]);
		const playbooks = runCli(["playbooks", "list", "--format=json"]);
		const capabilities = runCli(["capabilities", "--format=json"]);
		const prime = runCli([
			"prime",
			"--goal",
			"schedule campaign",
			"--format=json",
		]);

		for (const result of [
			search,
			describe,
			playbooks,
			capabilities,
			prime,
		]) {
			expect(result.exitCode).toBe(0);
		}
		expect(search.output).toContain('"id": "campaigns.schedule"');
		expect(describe.output).toContain('"confirmation": "required"');
		expect(playbooks.output).toContain('"campaign.safe-start"');
		expect(capabilities.output).toContain('"schema_version": "2.0.0"');
		expect(capabilities.output).toContain('"described_operations": 119');
		expect(capabilities.output).toContain('"migration_operations": 0');
		expect(prime.output).toContain('"recommended_operations"');
	});

	test("lists shared operation contracts without Listmonk credentials", () => {
		const result = runCli(["operations", "--family", "campaigns"]);

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain('"family": "campaigns"');
		expect(result.output).toContain('"mcpName": "listmonk_get_campaigns"');
	});

	test("prints the package version", () => {
		const result = runCli(["--version"]);

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain(packageJson.version);
	});

	test("renders nested group and leaf help", () => {
		const group = runCli(["campaigns", "--help"]);
		const leaf = runCli(["campaigns", "get", "--help"]);
		const schedule = runCli(["campaigns", "schedule", "--help"]);
		const start = runCli(["campaigns", "start", "--help"]);
		const pause = runCli(["campaigns", "pause", "--help"]);
		const cancel = runCli(["campaigns", "cancel", "--help"]);
		const templateReconcile = runCli(["templates", "reconcile", "--help"]);
		const userRoleReconcile = runCli(["user-roles", "reconcile", "--help"]);

		expect(group.exitCode).toBe(0);
		expect(group.output).toContain("list");
		expect(group.output).toContain("get");
		expect(leaf.exitCode).toBe(0);
		expect(leaf.output).toContain("--id");
		expect(schedule.output).toContain("--expected-updated-at");
		expect(start.output).toContain("--expected-updated-at");
		expect(pause.output).toContain("--expected-updated-at");
		expect(cancel.output).toContain("--expected-updated-at");
		expect(templateReconcile.output).toContain("--manifest-file");
		expect(templateReconcile.output).toContain("--dry-run");
		expect(userRoleReconcile.output).toContain("--manifest-file");
		expect(userRoleReconcile.output).toContain("--dry-run");
	});

	test("exposes list pagination flags", () => {
		const result = runCli(["lists", "list", "--help"]);

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("--page");
		expect(result.output).toContain("--per-page");
	});

	test("forwards opaque campaign revision tokens without narrowing the shared contract", () => {
		const result = runCli([
			"campaigns",
			"start",
			"--id",
			"42",
			"--expected-updated-at",
			"2026-07-31 03:00:00.123456+09",
			"--confirm",
		]);

		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain("Missing LISTMONK_API_TOKEN");
	});

	test("rejects empty campaign revision tokens before execution", () => {
		const result = runCli([
			"campaigns",
			"start",
			"--id",
			"42",
			"--expected-updated-at",
			"",
			"--confirm",
		]);

		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain("expected-updated-at");
		expect(result.output).not.toContain("Missing LISTMONK_API_TOKEN");
	});

	test("rejects non-canonical A/B revision timestamps before execution", () => {
		const result = runCli([
			"abtest",
			"run",
			"--test-id",
			"test-offset-revision",
			"--expected-status",
			"analyzing",
			"--expected-updated-at",
			"2026-07-31T03:00:00+09:00",
			"--confirm",
		]);

		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain("expected-updated-at");
		expect(result.output).not.toContain("Missing LISTMONK_API_TOKEN");
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

	test("exposes shared media commands", () => {
		const group = runCli(["media", "--help"]);
		const get = runCli(["media", "get", "--help"]);
		const remove = runCli(["media", "delete", "--help"]);

		expect(group.exitCode).toBe(0);
		for (const command of ["list", "get", "delete"]) {
			expect(group.output).toContain(command);
		}
		expect(get.output).toContain("--id");
		expect(remove.output).toContain("--id");
	});

	test("exposes the shared A/B test lifecycle commands", () => {
		const group = runCli(["abtest", "--help"]);
		const recommendation = runCli(["abtest", "recommend-sample-size", "--help"]);
		const deploy = runCli(["abtest", "deploy-winner", "--help"]);
		const run = runCli(["abtest", "run", "--help"]);

		expect(group.exitCode).toBe(0);
		for (const command of [
			"list",
			"get",
			"create",
			"analyze",
			"launch",
			"stop",
			"delete",
			"recommend-sample-size",
			"deploy-winner",
		]) {
			expect(group.output).toContain(command);
		}
		expect(recommendation.output).toContain("--lists");
		expect(deploy.output).toContain("--test-id");
		expect(run.output).toContain("--expected-status");
		expect(run.output).toContain("--expected-updated-at");
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

	test("prints confirmation flags for confirmation-gated examples", () => {
		const result = runCli(["examples"]);

		expect(result.exitCode).toBe(0);
		expect(result.output).toMatch(/abtest create[^\n]*--confirm/);
		expect(result.output).toMatch(/ops guard[^\n]*--confirm/);
	});

	test("accepts legacy explicit boolean values", () => {
		const result = runCli([
			"ops",
			"guard",
			"--campaign-id",
			"1",
			"--pause-on-breach",
			"true",
			"--confirm",
		]);

		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain("Deliverability guard failed");
		expect(result.output).toContain("Missing LISTMONK_API_TOKEN");
		expect(result.output).not.toMatch(
			/unknown (option|argument|command)|unexpected (option|argument)/i,
		);
	});

	test("accepts Gunshi negated boolean options", () => {
		const result = runCli([
			"ops",
			"guard",
			"--campaign-id",
			"1",
			"--no-pause-on-breach",
			"--confirm",
		]);

		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain("Missing LISTMONK_API_TOKEN");
		expect(result.output).not.toMatch(
			/unknown (option|argument|command)|unexpected (option|argument)/i,
		);
	});
});
