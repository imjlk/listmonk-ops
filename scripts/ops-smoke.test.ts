import {
	chmod,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

const root = resolve(import.meta.dir, "..");
const smokeScript = resolve(import.meta.dir, "ops-smoke.sh");
const REMOTE_URL = "https://listmonk.example.invalid/api";
const USERNAME = "smoke-user";
const TOKEN = "smoke-token";
const SMOKE_TIMEOUT_MS = 60_000;

type RecordedRequest = {
	method: string;
	path: string;
	authorization: string | null;
};

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) {
		await cleanup();
	}
});

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "listmonk-ops-smoke-test-"));
	cleanups.push(() => rm(directory, { recursive: true, force: true }));
	for (const name of ["home", "tmp", "logs"]) {
		await mkdir(join(directory, name));
	}
	return directory;
}

/** A loopback stand-in for Listmonk that records every request it receives. */
function startFakeListmonk(
	acceptedToken?: string,
	beforeResponse?: (request: RecordedRequest) => Promise<void>,
) {
	const requests: RecordedRequest[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const url = new URL(request.url);
			const authorization = request.headers.get("authorization");
			const recorded = {
				method: request.method,
				path: `${url.pathname}${url.search}`,
				authorization,
			};
			requests.push(recorded);
			await beforeResponse?.(recorded);
			if (url.pathname === "/health") {
				return Response.json({ data: true });
			}
			if (authorization !== `token ${USERNAME}:${acceptedToken}`) {
				return Response.json({ message: "Invalid API token" }, { status: 403 });
			}
			if (url.pathname === "/api/about") {
				return Response.json({ data: { version: "v6.2.0" } });
			}
			return Response.json({
				data: { results: [], total: 0, per_page: 20, page: 1 },
			});
		},
	});
	cleanups.push(() => server.stop(true));
	return { url: `http://127.0.0.1:${server.port}/api`, requests };
}

/** Start the smoke with a minimal environment: no GITHUB_ENV or operator shell. */
function startSmoke(directory: string, env: Record<string, string>) {
	const child = Bun.spawn(["bash", smokeScript], {
		cwd: root,
		env: {
			PATH: process.env.PATH ?? "",
			HOME: join(directory, "home"),
			TMPDIR: join(directory, "tmp"),
			LISTMONK_OPS_SMOKE_LOG_DIR: join(directory, "logs"),
			LISTMONK_TEST_TOKEN_FILE: join(directory, "token"),
			...env,
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const result = Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]).then(([stdout, stderr, exitCode]) => ({
		stdout,
		stderr,
		exitCode,
		output: `${stdout}\n${stderr}`,
	}));
	return { child, result };
}

function runSmoke(directory: string, env: Record<string, string>) {
	return startSmoke(directory, env).result;
}

async function leftoverStateDirectories(directory: string): Promise<string[]> {
	return (await readdir(join(directory, "tmp"))).filter((name) =>
		name.startsWith("listmonk-ops-smoke."),
	);
}

describe("ops smoke local target isolation", () => {
	test(
		"refuses a non-local resolved target before any request",
		async () => {
			const directory = await temporaryDirectory();
			const stubs = join(directory, "bin");
			const curlLog = join(directory, "curl.log");
			await mkdir(stubs);
			await writeFile(curlLog, "");
			await writeFile(
				join(stubs, "curl"),
				'#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" >>"$CURL_LOG"\nexit 7\n',
			);
			await chmod(join(stubs, "curl"), 0o755);
			const env = {
				PATH: `${stubs}${delimiter}${process.env.PATH ?? ""}`,
				CURL_LOG: curlLog,
				LISTMONK_API_URL: REMOTE_URL,
				LISTMONK_API_TOKEN: "remote-token",
			};

			const refused = await runSmoke(directory, env);
			expect(refused.exitCode, refused.output).toBe(1);
			expect(refused.stderr).toContain(
				`Refusing to target non-local Listmonk ${REMOTE_URL}`,
			);
			expect(refused.stderr).toContain("LISTMONK_OPS_SMOKE_ALLOW_REMOTE=1");
			expect(await readFile(curlLog, "utf8")).toBe("");

			const allowed = await runSmoke(directory, {
				...env,
				LISTMONK_OPS_SMOKE_ALLOW_REMOTE: "1",
			});
			expect(allowed.exitCode, allowed.output).toBe(1);
			expect(allowed.stdout).toContain("[smoke] target=remote");
			expect(await readFile(curlLog, "utf8")).toBe(
				"-fsS https://listmonk.example.invalid/health\n",
			);
			expect(await leftoverStateDirectories(directory)).toEqual([]);
		},
		SMOKE_TIMEOUT_MS,
	);

	test(
		"runs every step against the resolved loopback target despite operator profiles",
		async () => {
			const directory = await temporaryDirectory();
			const local = startFakeListmonk(TOKEN);
			const profileTarget = startFakeListmonk("production-token");
			const home = join(directory, "home");
			const operatorState = join(directory, "operator-state");
			await mkdir(join(home, ".listmonk-ops"));
			await mkdir(operatorState);
			await writeFile(
				join(home, ".listmonk-ops", "config.json"),
				JSON.stringify({
					schemaVersion: 1,
					defaultProfile: "production",
					profiles: {
						production: {
							baseUrl: profileTarget.url,
							username: USERNAME,
							tokenFile: "production-token",
						},
					},
				}),
			);
			await writeFile(
				join(home, ".listmonk-ops", "production-token"),
				"production-token\n",
				{ mode: 0o600 },
			);

			const result = await runSmoke(directory, {
				LISTMONK_API_URL: local.url,
				LISTMONK_USERNAME: USERNAME,
				LISTMONK_API_TOKEN: TOKEN,
				LISTMONK_OPS_PROFILE: "production",
				LISTMONK_API_TOKEN_FILE: join(home, ".listmonk-ops", "production-token"),
				LISTMONK_OPS_DATA_DIR: operatorState,
			});

			expect(result.exitCode, result.output).toBe(0);
			expect(result.stdout).toContain(`[smoke] api_url=${local.url}`);
			expect(profileTarget.requests).toEqual([]);
			const paths = local.requests.map((request) => request.path);
			expect(paths).toContain("/api/lists?page=1&per_page=1");
			expect(paths.some((path) => path.startsWith("/api/campaigns"))).toBe(
				true,
			);
			expect(paths.some((path) => path.startsWith("/api/subscribers"))).toBe(
				true,
			);
			for (const request of local.requests) {
				if (request.authorization !== null) {
					expect(request.authorization).toBe(`token ${USERNAME}:${TOKEN}`);
				}
			}
			expect(await readdir(operatorState)).toEqual([]);
			expect(await readFile(join(directory, "token"), "utf8")).toBe(
				`${TOKEN}\n`,
			);
			expect((await stat(join(directory, "token"))).mode & 0o077).toBe(0);
			expect(
				JSON.parse(await readFile(join(directory, "logs", "report.json"), "utf8")),
			).toMatchObject({ mode: "quick", api_url: local.url });
			expect(await leftoverStateDirectories(directory)).toEqual([]);
		},
		SMOKE_TIMEOUT_MS,
	);

	test(
		"never runs steps with a stale cached token",
		async () => {
			const directory = await temporaryDirectory();
			const local = startFakeListmonk(TOKEN);
			await writeFile(join(directory, "token"), "stale-token\n", {
				mode: 0o600,
			});

			const result = await runSmoke(directory, {
				LISTMONK_API_URL: local.url,
				LISTMONK_USERNAME: USERNAME,
			});

			expect(result.exitCode, result.output).toBe(1);
			expect(result.stdout).toContain(
				`Unable to validate or provision a Listmonk API token for ${USERNAME}`,
			);
			expect(
				local.requests.filter(
					(request) =>
						request.authorization === `token ${USERNAME}:stale-token`,
				),
			).toEqual([
				{
					method: "GET",
					path: "/api/lists?page=1&per_page=1",
					authorization: `token ${USERNAME}:stale-token`,
				},
			]);
			expect(
				local.requests.some((request) =>
					request.path.startsWith("/api/campaigns"),
				),
			).toBe(false);
			expect(await leftoverStateDirectories(directory)).toEqual([]);
		},
		SMOKE_TIMEOUT_MS,
	);

	test(
		"stops at an interrupted step even when its command exits normally",
		async () => {
			const directory = await temporaryDirectory();
			const smoke: { child?: Bun.Subprocess } = {};
			// Interrupt the script (not its CLI child) during `campaigns list`; the
			// delayed response then lets that CLI step finish successfully.
			const local = startFakeListmonk(TOKEN, async (request) => {
				if (request.path.startsWith("/api/campaigns")) {
					smoke.child?.kill("SIGINT");
					await Bun.sleep(300);
				}
			});
			const run = startSmoke(directory, {
				LISTMONK_API_URL: local.url,
				LISTMONK_USERNAME: USERNAME,
				LISTMONK_API_TOKEN: TOKEN,
			});
			smoke.child = run.child;

			const result = await run.result;

			expect(result.exitCode, result.output).toBe(130);
			expect(
				local.requests.some((request) => request.path.startsWith("/api/campaigns")),
			).toBe(true);
			for (const laterStep of ["/api/templates", "/api/subscribers"]) {
				expect(
					local.requests.some((request) => request.path.startsWith(laterStep)),
				).toBe(false);
			}
			expect(result.stdout).not.toContain("SUMMARY");
			expect(await leftoverStateDirectories(directory)).toEqual([]);
		},
		SMOKE_TIMEOUT_MS,
	);
});
