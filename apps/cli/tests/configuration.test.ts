import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const cliDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("CLI config show exposes selected sources and isolated state without reading the token", async () => {
	const home = await mkdtemp(join(tmpdir(), "cli-profile-"));
	directories.push(home);
	const configFile = join(home, "profiles.json");
	await writeFile(configFile, JSON.stringify({ schemaVersion: 1, profiles: { production: { baseUrl: "https://prod.test", username: "prod", tokenFile: "not-created" } } }));
	const binary = process.env.CLI_TEST_EXECUTABLE?.trim();
	const args = [
		"config",
		"show",
		"--profile=production",
		"--config",
		configFile,
		"--format=json",
	];
	const child = Bun.spawn(
		binary ? [binary, ...args] : ["bun", "src/index.ts", ...args],
		{
			cwd: cliDirectory,
			env: {
				...process.env,
				HOME: home,
				LISTMONK_API_URL: "https://wrong.test",
				LISTMONK_USERNAME: "wrong",
				LISTMONK_API_TOKEN: "wrong-secret",
			},
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	expect(exitCode).toBe(0);
	expect(stderr).toBe("");
	const output = JSON.parse(stdout);
	expect(output.baseUrl).toBe("https://prod.test/api");
	expect(output.username).toBe("prod");
	expect(output.authentication.reference).toBe(join(home, "not-created"));
	expect(output.sources.baseUrl).toEqual({
		kind: "profile",
		name: "production.baseUrl",
	});
	expect(output.dataDirectory).toStartWith(
		join(home, ".listmonk-ops", "profiles", "production-"),
	);
	expect(stdout).not.toContain("wrong-secret");
});

test("local transactional inspection remains available when the selected token file is missing", async () => {
	const home = await mkdtemp(join(tmpdir(), "cli-tx-local-"));
	directories.push(home);
	const configFile = join(home, "profiles.json");
	await writeFile(configFile, JSON.stringify({ schemaVersion: 1, profiles: { local: { baseUrl: "http://127.0.0.1:1/api", username: "operator", tokenFile: "missing-token" } } }));
	const binary = process.env.CLI_TEST_EXECUTABLE?.trim();
	const args = [
		"tx",
		"records",
		"--profile=local",
		"--config",
		configFile,
		"--format=json",
	];
	const child = Bun.spawn(
		binary ? [binary, ...args] : ["bun", "src/index.ts", ...args],
		{
			cwd: cliDirectory,
			env: { ...process.env, HOME: home },
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	expect(code).toBe(0);
	expect(stderr).toBe("");
	expect(JSON.parse(stdout)).toMatchObject({ records: [], total: 0 });
});

test("help remains available with an invalid configuration file", async () => {
	const home = await mkdtemp(join(tmpdir(), "cli-profile-help-"));
	directories.push(home);
	await mkdir(join(home, ".listmonk-ops"));
	await writeFile(join(home, ".listmonk-ops", "config.json"), "invalid json");
	const binary = process.env.CLI_TEST_EXECUTABLE?.trim();
	const args = ["--help"];
	const child = Bun.spawn(
		binary ? [binary, ...args] : ["bun", "src/index.ts", ...args],
		{
			cwd: cliDirectory,
			env: { ...process.env, HOME: home },
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [stdout, , code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	expect(code).toBe(0);
	expect(stdout).toContain("config");
});

test("all default file repositories share the selected profile directory and retain explicit overrides", async () => {
	const { resolveListmonkConfiguration, getOperationAuditStorePath, getTransactionalStorePath, getResourceCreateStorePath } = await import("@listmonk-ops/common");
	const { getOpsStorePaths, getSequenceStorePath, getOutboundWebhookStorePath } = await import("@listmonk-ops/automation");
	const { getAbTestStorePath } = await import("@listmonk-ops/abtest");
	const home = await mkdtemp(join(tmpdir(), "profile-state-paths-"));
	directories.push(home);
	const configFile = join(home, "profiles.json");
	await writeFile(configFile, JSON.stringify({ schemaVersion: 1, profiles: { one: { baseUrl: "https://one.test", username: "one" } } }));
	const selected = await resolveListmonkConfiguration({ configFile, profile: "one", homeDirectory: home, env: {} });
	const names = ["LISTMONK_OPS_DATA_DIR", "LISTMONK_OPS_AUDIT_STORE", "LISTMONK_OPS_TRANSACTIONAL_STORE", "LISTMONK_OPS_RESOURCE_CREATE_STORE", "LISTMONK_OPS_ABTEST_STORE", "LISTMONK_OPS_SEQUENCE_STORE", "LISTMONK_OPS_WEBHOOK_STORE", "LISTMONK_OPS_SEGMENT_STORE", "LISTMONK_OPS_TEMPLATE_REGISTRY"];
	const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
	try {
		for (const name of names) delete process.env[name];
		process.env.LISTMONK_OPS_DATA_DIR = selected.summary.dataDirectory;
		const paths = [getOperationAuditStorePath(), getTransactionalStorePath(), getResourceCreateStorePath(), getAbTestStorePath(), getSequenceStorePath(), getOutboundWebhookStorePath(), ...Object.values(getOpsStorePaths())];
		for (const path of paths) expect(path).toStartWith(`${selected.summary.dataDirectory}${sep}`);
		process.env.LISTMONK_OPS_AUDIT_STORE = join(home, "explicit-audit.json");
		expect(getOperationAuditStorePath()).toBe(join(home, "explicit-audit.json"));
	} finally {
		for (const name of names) {
			if (previous[name] === undefined) delete process.env[name];
			else process.env[name] = previous[name];
		}
	}
});
