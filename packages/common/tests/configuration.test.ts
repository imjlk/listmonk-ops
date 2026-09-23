import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveListmonkConfiguration } from "../src/configuration";

const directories: string[] = [];
async function fixture(profiles?: Record<string, unknown>, defaultProfile?: string) {
	const home = await mkdtemp(join(tmpdir(), "listmonk-config-test-"));
	directories.push(home);
	const configFile = join(home, "config", "profiles.json");
	if (profiles) {
		await mkdir(join(home, "config"));
		await writeFile(
			configFile,
			JSON.stringify({
				schemaVersion: 1,
				profiles,
				...(defaultProfile ? { defaultProfile } : {}),
			}),
		);
	}
	return {
		homeDirectory: home,
		workingDirectory: home,
		configFile,
		env: {} as Record<string, string | undefined>,
	};
}
afterEach(async () => {
	await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("shared Listmonk configuration", () => {
	test("preserves legacy env defaults and reports sources without authentication values", async () => {
		const fixtureOptions = await fixture();
		const options = {
			homeDirectory: fixtureOptions.homeDirectory,
			env: {
				LISTMONK_API_URL: "https://example.test/",
				LISTMONK_USERNAME: "operator",
				LISTMONK_API_TOKEN: "secret-value",
			},
		};
		const resolved = await resolveListmonkConfiguration(options);
		expect(resolved.summary.baseUrl).toBe("https://example.test/api");
		expect(resolved.summary.sources.baseUrl).toEqual({
			kind: "environment",
			name: "LISTMONK_API_URL",
		});
		expect(await resolved.readCredential()).toBe("secret-value");
		expect(JSON.stringify(resolved)).not.toContain("secret-value");
		expect(resolved.summary.dataDirectory).toBe(
			join(options.homeDirectory, ".listmonk-ops"),
		);
	});

	test("selected profiles cannot inherit another instance's URL, username, token, or data directory", async () => {
		const options = await fixture({ production: { baseUrl: "https://prod.test", username: "prod", tokenEnv: "PROD_TOKEN" } }, "production");
		options.env = { LISTMONK_API_URL: "https://staging.test", LISTMONK_USERNAME: "staging", LISTMONK_API_TOKEN: "staging-secret", LISTMONK_OPS_DATA_DIR: "/staging" };
		const resolved = await resolveListmonkConfiguration(options);
		expect(resolved.summary.baseUrl).toBe("https://prod.test/api");
		expect(resolved.summary.username).toBe("prod");
		expect(resolved.summary.dataDirectory).toStartWith(
			join(options.homeDirectory, ".listmonk-ops", "profiles", "production-"),
		);
		expect(resolved.summary.sources.dataDirectory).toEqual({ kind: "default" });
		expect(await resolved.readCredential()).toBeUndefined();
		options.env.PROD_TOKEN = "rotated-environment-secret";
		expect(await resolved.readCredential()).toBe("rotated-environment-secret");
		expect(JSON.stringify(resolved)).not.toContain("rotated-environment-secret");
	});

	test("rereads atomic token-file replacements and anchors relative profile paths to the config file", async () => {
		const options = await fixture({ local: { baseUrl: "http://localhost:9000/api", username: "test", tokenFile: "token", dataDirectory: "state" } });
		const tokenFile = join(options.homeDirectory, "config", "token");
		await writeFile(tokenFile, "first-secret\n");
		const resolved = await resolveListmonkConfiguration({ ...options, profile: "local", workingDirectory: tmpdir() });
		expect(await resolved.readCredential()).toBe("first-secret");
		await writeFile(`${tokenFile}.new`, "second-secret\n");
		await rename(`${tokenFile}.new`, tokenFile);
		expect(await resolved.readCredential()).toBe("second-secret");
		expect(resolved.summary.authentication.reference).toBe(tokenFile);
		expect(resolved.summary.dataDirectory).toBe(
			join(options.homeDirectory, "config", "state"),
		);
		expect(resolved.summary.sources.dataDirectory).toEqual({
			kind: "profile",
			name: "local.dataDirectory",
		});
	});

	test("preserves legacy password whitespace without weakening token validation", async () => {
		const options = await fixture();
		const settings = { ...options, configFile: undefined };
		const inline = await resolveListmonkConfiguration({ ...settings, allowLegacyPassword: true, password: " leading and trailing " });
		expect(await inline.readCredential()).toBe(" leading and trailing ");
		const environment = await resolveListmonkConfiguration({ ...settings, allowLegacyPassword: true, env: { LISTMONK_PASSWORD: " pass phrase " } });
		expect(await environment.readCredential()).toBe(" pass phrase ");
		const unsafe = await resolveListmonkConfiguration({ ...settings, allowLegacyPassword: true, password: "bad\nheader" });
		await expect(unsafe.readCredential()).rejects.toThrow("Invalid Listmonk authentication value");
		const token = await resolveListmonkConfiguration({ ...settings, apiToken: "bad token" });
		await expect(token.readCredential()).rejects.toThrow("Invalid Listmonk authentication value");
	});

	test("uses deterministic separate default state for each target and profile", async () => {
		const options = await fixture({ one: { baseUrl: "https://one.test", username: "test" }, two: { baseUrl: "https://two.test", username: "test" } });
		const one = await resolveListmonkConfiguration({ ...options, profile: "one" });
		const repeated = await resolveListmonkConfiguration({ ...options, profile: "one", workingDirectory: tmpdir() });
		const two = await resolveListmonkConfiguration({ ...options, profile: "two" });
		const changed = await resolveListmonkConfiguration({ ...options, profile: "one", baseUrl: "https://different.test" });
		expect(one.summary.dataDirectory).toBe(repeated.summary.dataDirectory);
		expect(one.summary.dataDirectory).not.toBe(two.summary.dataDirectory);
		expect(one.summary.dataDirectory).not.toBe(changed.summary.dataDirectory);
	});

	test("explicit arguments override profile values without exposing inline tokens", async () => {
		const options = await fixture({ one: { baseUrl: "https://one.test", username: "test", tokenEnv: "ONE_TOKEN" } });
		const resolved = await resolveListmonkConfiguration({ ...options, profile: "one", baseUrl: "https://override.test", username: "override", apiToken: "argument-secret" });
		expect(resolved.summary.baseUrl).toBe("https://override.test/api");
		expect(resolved.summary.sources.username.kind).toBe("argument");
		expect(await resolved.readCredential()).toBe("argument-secret");
		expect(JSON.stringify(resolved)).not.toContain("argument-secret");
	});

	test("token-file env wins over legacy inline env and resolves relative to home", async () => {
		const options = await fixture();
		await writeFile(join(options.homeDirectory, "token"), "file-secret");
		const resolved = await resolveListmonkConfiguration({ homeDirectory: options.homeDirectory, workingDirectory: tmpdir(), env: { LISTMONK_API_TOKEN: "old-secret", LISTMONK_API_TOKEN_FILE: "token" } });
		expect(await resolved.readCredential()).toBe("file-secret");
	});

	test("rejects unknown profiles and ambiguous or inline credentials in profile documents", async () => {
		const options = await fixture({ one: { baseUrl: "https://one.test", username: "test" } });
		await expect(resolveListmonkConfiguration({ ...options, profile: "missing" })).rejects.toThrow("does not exist");
		for (const addition of [{ tokenEnv: "TOKEN", tokenFile: "file" }, { token: "secret-value" }]) {
			await writeFile(options.configFile, JSON.stringify({ schemaVersion: 1, profiles: { one: { baseUrl: "https://one.test", username: "test", ...addition } } }));
			await expect(resolveListmonkConfiguration(options)).rejects.toThrow("Invalid Listmonk profile entry");
		}
	});

	test("rejects oversized, empty, malformed, and non-regular authentication files", async () => {
		const options = await fixture();
		const tokenFile = join(options.homeDirectory, "token");
		const resolved = await resolveListmonkConfiguration({ homeDirectory: options.homeDirectory, env: {}, tokenFile });
		for (const value of ["", "x".repeat(16_385), "secret\nmalformed"]) {
			await writeFile(tokenFile, value);
			await expect(resolved.readCredential()).rejects.toThrow();
		}
		await rm(tokenFile);
		await mkdir(tokenFile);
		await expect(resolved.readCredential()).rejects.toThrow("bounded regular file");
	});
});
