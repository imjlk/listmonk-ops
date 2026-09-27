import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import {
	isLoopbackHostname,
	readCreatedRecordId,
	readResolvedBaseUrl,
	resolveLocalTestTarget,
} from "./local-test-target";

const helper = resolve(import.meta.dir, "local-test-target.ts");
const REMOTE_URL = "https://listmonk.example.invalid/api";
const SMOKE_OPTIONS = {
	allowRemote: false,
	overrideVariable: "LISTMONK_OPS_SMOKE_ALLOW_REMOTE",
};

function configuration(baseUrl: string): string {
	return JSON.stringify({
		availableProfiles: [],
		baseUrl,
		username: "api-admin",
	});
}

async function runHelper(
	args: string[],
	stdin: string,
	env: Record<string, string> = {},
) {
	const child = Bun.spawn(["bun", helper, ...args], {
		env: { PATH: process.env.PATH ?? "", ...env },
		stdin: new TextEncoder().encode(stdin),
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout, stderr, exitCode };
}

describe("local test target guard", () => {
	test("recognizes loopback hosts as URL.hostname reports them", () => {
		expect(new URL("http://[::1]:9000/api").hostname).toBe("[::1]");
		for (const hostname of ["localhost", "127.0.0.1", "[::1]"]) {
			expect(isLoopbackHostname(hostname)).toBe(true);
		}
		expect(isLoopbackHostname("::1")).toBe(false);
		for (const url of [
			"http://localhost:9000/api",
			"http://127.0.0.1:19000/api",
			"http://[::1]:9000/api",
		]) {
			expect(
				resolveLocalTestTarget(configuration(url), SMOKE_OPTIONS),
			).toEqual({ kind: "loopback", baseUrl: url });
		}
		for (const url of [
			REMOTE_URL,
			"http://localhost.example.com/api",
			"http://localhost@listmonk.example.com/api",
			"http://192.168.1.10:9000/api",
		]) {
			expect(() =>
				resolveLocalTestTarget(configuration(url), SMOKE_OPTIONS),
			).toThrow("Refusing to target non-local Listmonk");
		}
	});

	test("re-serializes the reported URL into one shell-safe token", () => {
		expect(
			resolveLocalTestTarget(
				configuration("\n http://LOCALHOST:9000/api/ \t"),
				SMOKE_OPTIONS,
			),
		).toEqual({ kind: "loopback", baseUrl: "http://localhost:9000/api" });
		for (const allowRemote of [false, true]) {
			expect(() =>
				resolveLocalTestTarget(configuration("ftp://localhost/api"), {
					...SMOKE_OPTIONS,
					allowRemote,
				}),
			).toThrow("must use HTTP or HTTPS");
			expect(() =>
				resolveLocalTestTarget(configuration("not a url"), {
					...SMOKE_OPTIONS,
					allowRemote,
				}),
			).toThrow("invalid baseUrl");
		}
	});

	test("reads the resolved base URL from config show output", () => {
		expect(readResolvedBaseUrl(configuration("http://[::1]:9000/api"))).toBe(
			"http://[::1]:9000/api",
		);
		expect(() => readResolvedBaseUrl("not json")).toThrow(
			"did not return a JSON object",
		);
		expect(() => readResolvedBaseUrl("{}")).toThrow("did not report a baseUrl");
	});

	test("fails closed on a remote target unless explicitly allowed", () => {
		expect(() =>
			resolveLocalTestTarget(configuration(REMOTE_URL), SMOKE_OPTIONS),
		).toThrow(
			`Refusing to target non-local Listmonk ${REMOTE_URL}. Set LISTMONK_OPS_SMOKE_ALLOW_REMOTE=1`,
		);
		expect(
			resolveLocalTestTarget(configuration(REMOTE_URL), {
				...SMOKE_OPTIONS,
				allowRemote: true,
			}),
		).toEqual({ kind: "remote", baseUrl: REMOTE_URL });
	});

	test("reads a created record id only when the record matches the fixture", () => {
		const output = JSON.stringify({
			subscriber: {
				id: 42,
				email: "ops-smoke-1@example.com",
				lists: [{ id: 1 }],
			},
			created: true,
		});
		const match = {
			key: "subscriber",
			field: "email",
			value: "ops-smoke-1@example.com",
		};
		expect(readCreatedRecordId(output, match)).toBe("42");
		expect(
			readCreatedRecordId(output, { ...match, value: "someone@example.com" }),
		).toBeUndefined();
		expect(
			readCreatedRecordId(output, { ...match, key: "template" }),
		).toBeUndefined();
		for (const id of [0, -1, 1.5, "", "42; rm -rf /", "a b", null]) {
			expect(
				readCreatedRecordId(
					JSON.stringify({
						subscriber: { id, email: match.value },
						created: true,
					}),
					match,
				),
			).toBeUndefined();
		}
		// A replayed record (for example an existing subscriber with the same
		// email) was not created by this run and must never be cleaned up.
		for (const created of [false, undefined, "true"]) {
			expect(
				readCreatedRecordId(
					JSON.stringify({
						subscriber: { id: 42, email: match.value },
						created,
					}),
					match,
				),
			).toBeUndefined();
		}
		expect(readCreatedRecordId("", match)).toBeUndefined();
		expect(
			readCreatedRecordId(
				JSON.stringify({
					test: { id: "test_1790000000000_k3j9x2m1a", name: "ops-smoke-ab-1" },
					created: true,
				}),
				{ key: "test", field: "name", value: "ops-smoke-ab-1" },
			),
		).toBe("test_1790000000000_k3j9x2m1a");
	});

	test("command line prints the target kind or refuses it", async () => {
		const loopback = await runHelper(
			["resolve", "LISTMONK_OPS_SMOKE_ALLOW_REMOTE"],
			configuration("http://127.0.0.1:9000/api"),
		);
		expect(loopback).toEqual({
			stdout: "loopback http://127.0.0.1:9000/api\n",
			stderr: "",
			exitCode: 0,
		});

		const refused = await runHelper(
			["resolve", "LISTMONK_OPS_SMOKE_ALLOW_REMOTE"],
			configuration(REMOTE_URL),
		);
		expect(refused.exitCode).toBe(1);
		expect(refused.stdout).toBe("");
		expect(refused.stderr).toContain(
			`Refusing to target non-local Listmonk ${REMOTE_URL}`,
		);

		const allowed = await runHelper(
			["resolve", "LISTMONK_OPS_SMOKE_ALLOW_REMOTE"],
			configuration(REMOTE_URL),
			{ LISTMONK_OPS_SMOKE_ALLOW_REMOTE: "1" },
		);
		expect(allowed.stdout).toBe(`remote ${REMOTE_URL}\n`);
		expect(allowed.exitCode).toBe(0);

		const usage = await runHelper(["resolve"], "");
		expect(usage.exitCode).toBe(2);
		expect(usage.stderr).toContain("Usage");
	});

	test("command line prints created ids and stays silent on a mismatch", async () => {
		const output = JSON.stringify({
			template: { id: 7, name: "ops-smoke-template-1" },
			created: true,
		});
		expect(
			await runHelper(
				["created-id", "template", "name", "ops-smoke-template-1"],
				output,
			),
		).toEqual({ stdout: "7\n", stderr: "", exitCode: 0 });
		expect(
			await runHelper(["created-id", "template", "name", "other"], output),
		).toEqual({ stdout: "", stderr: "", exitCode: 0 });
	});
});
