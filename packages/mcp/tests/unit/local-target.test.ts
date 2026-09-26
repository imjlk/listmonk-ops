import { afterEach, describe, expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveListmonkConfiguration } from "@listmonk-ops/common";
import {
	assertLocalListmonkTarget,
	createIsolatedListmonkEnvironment,
	isLoopbackListmonkUrl,
} from "../local-target";

// Never contacted: configuration resolution does not open connections.
const HARNESS_URL = "http://127.0.0.1:1/api";
const PROFILE_URL = "https://listmonk.example.invalid/api";

const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "listmonk-local-target-"));
	directories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

/** An operator shell that selects a remote shared profile in every supported way. */
async function operatorEnvironment() {
	const home = await temporaryDirectory();
	await mkdir(join(home, ".listmonk-ops"));
	const profiles = JSON.stringify({
		schemaVersion: 1,
		defaultProfile: "production",
		profiles: {
			production: {
				baseUrl: PROFILE_URL,
				username: "ops",
				tokenFile: "production-token",
			},
		},
	});
	await writeFile(join(home, ".listmonk-ops", "config.json"), profiles);
	const configFile = join(home, "operator-profiles.json");
	await writeFile(configFile, profiles);
	return {
		home,
		env: {
			LISTMONK_API_URL: HARNESS_URL,
			LISTMONK_USERNAME: "api-admin",
			LISTMONK_API_TOKEN: "harness-token",
			LISTMONK_OPS_CONFIG: configFile,
			LISTMONK_OPS_PROFILE: "production",
			LISTMONK_API_TOKEN_FILE: join(home, "production-token"),
			LISTMONK_OPS_DATA_DIR: join(home, "operator-state"),
		},
	};
}

describe("local E2E target isolation", () => {
	test("without isolation, an operator profile replaces the harness target", async () => {
		const { home, env } = await operatorEnvironment();
		const { summary } = await resolveListmonkConfiguration({
			env,
			homeDirectory: home,
		});

		expect(summary.profile).toBe("production");
		expect(summary.baseUrl).toBe(PROFILE_URL);
		await expect(
			assertLocalListmonkTarget({
				env,
				expectedBaseUrl: HARNESS_URL,
				allowRemote: false,
				homeDirectory: home,
			}),
		).rejects.toThrow(`would target ${PROFILE_URL}`);
	});

	test("isolated environment writes an empty profile document and strips profile selection", async () => {
		const { home, env } = await operatorEnvironment();
		const directory = await temporaryDirectory();
		const isolated = createIsolatedListmonkEnvironment(directory);
		const configFile = join(directory, "config.json");

		expect(isolated).toEqual({
			LISTMONK_OPS_CONFIG: configFile,
			LISTMONK_OPS_PROFILE: "",
			LISTMONK_API_TOKEN_FILE: "",
			LISTMONK_OPS_DATA_DIR: join(directory, "data"),
		});
		expect(JSON.parse(await readFile(configFile, "utf8"))).toEqual({
			schemaVersion: 1,
			profiles: {},
		});
		expect((await stat(configFile)).mode & 0o077).toBe(0);

		const { summary } = await resolveListmonkConfiguration({
			env: { ...env, ...isolated },
			homeDirectory: home,
		});
		expect(summary.profile).toBeUndefined();
		expect(summary.availableProfiles).toEqual([]);
		expect(summary.baseUrl).toBe(HARNESS_URL);
		expect(summary.sources.baseUrl).toEqual({
			kind: "environment",
			name: "LISTMONK_API_URL",
		});
		expect(summary.authentication).toEqual({
			kind: "token",
			source: { kind: "environment", name: "LISTMONK_API_TOKEN" },
			reference: "LISTMONK_API_TOKEN",
		});
		expect(summary.dataDirectory).toBe(join(directory, "data"));
		await expect(
			assertLocalListmonkTarget({
				env: { ...env, ...isolated },
				expectedBaseUrl: HARNESS_URL,
				allowRemote: false,
				homeDirectory: home,
			}),
		).resolves.toBe(HARNESS_URL);
	});

	test("refuses a non-local resolved target unless remote targets are allowed", async () => {
		const isolated = createIsolatedListmonkEnvironment(
			await temporaryDirectory(),
		);
		const env = { ...isolated, LISTMONK_API_URL: PROFILE_URL };

		await expect(
			assertLocalListmonkTarget({
				env,
				expectedBaseUrl: PROFILE_URL,
				allowRemote: false,
			}),
		).rejects.toThrow(
			`Refusing to run MCP E2E against non-local target ${PROFILE_URL}. Set LISTMONK_E2E_ALLOW_REMOTE=1 to override.`,
		);
		await expect(
			assertLocalListmonkTarget({
				env,
				expectedBaseUrl: PROFILE_URL,
				allowRemote: true,
			}),
		).resolves.toBe(PROFILE_URL);
	});

	test("accepts bracketed IPv6 loopback targets", async () => {
		const isolated = createIsolatedListmonkEnvironment(
			await temporaryDirectory(),
		);

		await expect(
			assertLocalListmonkTarget({
				env: { ...isolated, LISTMONK_API_URL: "http://[::1]:1/api" },
				expectedBaseUrl: "http://[::1]:1/api",
				allowRemote: false,
			}),
		).resolves.toBe("http://[::1]:1/api");
	});

	test("recognizes only loopback HTTP targets", () => {
		for (const url of [
			"http://localhost:9000/api",
			"http://127.0.0.1:9000/api",
			"https://[::1]:9000/api",
		]) {
			expect(isLoopbackListmonkUrl(url)).toBe(true);
		}
		for (const url of [
			"https://listmonk.example.com/api",
			"http://localhost.example.com/api",
			"http://localhost@listmonk.example.com/api",
			"http://10.0.0.5:9000/api",
			"ftp://localhost/api",
			"not a url",
		]) {
			expect(isLoopbackListmonkUrl(url)).toBe(false);
		}
	});
});
