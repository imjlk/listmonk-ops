import {
	chmod,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	symlink,
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
	body: string;
	/** Id the fake assigned when this request created a fixture. */
	createdId?: number;
};

type FakeListmonk = { url: string; requests: RecordedRequest[] };

const FIXTURE_PATH = /^\/api\/(subscribers|templates)(?:\/(\d+))?$/;
const EMPTY_PAGE = { results: [], total: 0, per_page: 20, page: 1 };

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

/**
 * A loopback stand-in for Listmonk that records every request it receives.
 * It accepts the token for any username, assigns subscriber and template ids,
 * and, like Listmonk, rejects a second subscriber with the same email, which
 * the CLI then replays as the existing subscriber with `created: false`.
 */
function startFakeListmonk(
	acceptedToken?: string,
	beforeResponse?: (
		request: RecordedRequest,
	) => Promise<Response | void> | Response | void,
): FakeListmonk {
	const requests: RecordedRequest[] = [];
	const fixtures = new Map<string, Record<string, unknown>>();
	let nextId = 4242;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const url = new URL(request.url);
			const authorization = request.headers.get("authorization");
			const recorded: RecordedRequest = {
				method: request.method,
				path: `${url.pathname}${url.search}`,
				authorization,
				body: await request.text(),
			};
			requests.push(recorded);
			const overriddenResponse = await beforeResponse?.(recorded);
			if (overriddenResponse instanceof Response) {
				return overriddenResponse;
			}
			if (url.pathname === "/health") {
				return Response.json({ data: true });
			}
			if (
				acceptedToken === undefined ||
				!authorization?.startsWith("token ") ||
				!authorization.endsWith(`:${acceptedToken}`)
			) {
				return Response.json({ message: "Invalid API token" }, { status: 403 });
			}
			if (url.pathname === "/api/about") {
				return Response.json({ data: { version: "v6.2.0" } });
			}
			const [, collection, id] = FIXTURE_PATH.exec(url.pathname) ?? [];
			if (collection !== undefined && id === undefined) {
				const subscribers = [...fixtures.entries()]
					.filter(([path]) => path.startsWith("/api/subscribers/"))
					.map(([, fixture]) => fixture);
				if (request.method === "POST") {
					const input = JSON.parse(recorded.body) as Record<string, unknown>;
					if (
						collection === "subscribers" &&
						subscribers.some((subscriber) => subscriber.email === input.email)
					) {
						return Response.json(
							{ message: "E-mail already exists." },
							{ status: 409 },
						);
					}
					const createdId = nextId++;
					recorded.createdId = createdId;
					const timestamps = {
						created_at: "2026-01-01T00:00:00Z",
						updated_at: "2026-01-01T00:00:00Z",
					};
					const fixture =
						collection === "subscribers"
							? {
									...input,
									...timestamps,
									id: createdId,
									uuid: `subscriber-${createdId}`,
									lists: [
										{ id: 1, name: "Default", subscription_status: "unconfirmed" },
									],
								}
							: { ...input, ...timestamps, id: createdId, is_default: false };
					fixtures.set(`${url.pathname}/${createdId}`, fixture);
					return Response.json({ data: fixture });
				}
				// Subscriber pages include the create-replay lookup by email.
				const results = collection === "subscribers" ? subscribers : [];
				return Response.json({
					data: { ...EMPTY_PAGE, results, total: results.length },
				});
			}
			if (id !== undefined && request.method === "DELETE") {
				// Listmonk also reports success for an already-deleted record.
				fixtures.delete(url.pathname);
				return Response.json({ data: true });
			}
			const fixture = fixtures.get(url.pathname);
			if (fixture !== undefined && request.method === "GET") {
				return Response.json({ data: fixture });
			}
			if (request.method === "GET" && !/\/\d+$/.test(url.pathname)) {
				return Response.json({ data: EMPTY_PAGE });
			}
			return Response.json({ message: "Not found" }, { status: 404 });
		},
	});
	cleanups.push(() => server.stop(true));
	return { url: `http://127.0.0.1:${server.port}/api`, requests };
}

function requestCount(fake: FakeListmonk, method: string, path: string) {
	return fake.requests.filter(
		(request) => request.method === method && request.path === path,
	).length;
}

function createdIds(fake: FakeListmonk, path: string, username = USERNAME) {
	return fake.requests
		.filter(
			(request) =>
				request.method === "POST" &&
				request.path === path &&
				request.authorization === `token ${username}:${TOKEN}`,
		)
		.map((request) => request.createdId);
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
				local.requests
					.filter(
						(request) =>
							request.authorization === `token ${USERNAME}:stale-token`,
					)
					.map((request) => `${request.method} ${request.path}`),
			).toEqual(["GET /api/lists?page=1&per_page=1"]);
			expect(
				local.requests.some((request) =>
					request.path.startsWith("/api/campaigns"),
				),
			).toBe(false);
			expect(await leftoverStateDirectories(directory)).toEqual([]);
		},
		SMOKE_TIMEOUT_MS,
	);

	for (const [signal, exitCode] of [
		["SIGINT", 130],
		["SIGTERM", 143],
		["SIGHUP", 129],
	] as const) {
		test(
			`stops at the step interrupted by ${signal} even when it exits normally`,
			async () => {
				const directory = await temporaryDirectory();
				const staleReport = join(directory, "logs", "report.json");
				await writeFile(staleReport, '{"summary":{"pass":6,"fail":0}}\n');
				const smoke: { child?: Bun.Subprocess } = {};
				// Signal the script (not its CLI child) during `campaigns list`; the
				// delayed response then lets that CLI step finish successfully.
				const local = startFakeListmonk(TOKEN, async (request) => {
					if (request.path.startsWith("/api/campaigns")) {
						smoke.child?.kill(signal);
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

				expect(result.exitCode, result.output).toBe(exitCode);
				expect(result.stdout).toContain(`[smoke] interrupted by ${signal}`);
				expect(
					local.requests.some((request) =>
						request.path.startsWith("/api/campaigns"),
					),
				).toBe(true);
				for (const laterStep of ["/api/templates", "/api/subscribers"]) {
					expect(
						local.requests.some((request) =>
							request.path.startsWith(laterStep),
						),
					).toBe(false);
				}
				expect(result.stdout).not.toContain("SUMMARY");
				expect(await Bun.file(staleReport).exists()).toBe(false);
				expect(await leftoverStateDirectories(directory)).toEqual([]);
			},
			SMOKE_TIMEOUT_MS,
		);
	}
});

// Full mode runs only against these in-process loopback fakes.
describe("ops smoke full-mode fixture cleanup", () => {
	const fullSmoke = (url: string, username = USERNAME) => ({
		LISTMONK_OPS_SMOKE_MODE: "full",
		LISTMONK_API_URL: url,
		LISTMONK_USERNAME: username,
		LISTMONK_API_TOKEN: TOKEN,
	});

	test(
		"deletes a fixture whose create finished while a signal stopped the run",
		async () => {
			const directory = await temporaryDirectory();
			const smoke: { child?: Bun.Subprocess } = {};
			// Signal the script during `subscribers create`; the create still
			// finishes and writes its output before bash honors the signal.
			const local = startFakeListmonk(TOKEN, async (request) => {
				if (request.method === "POST" && request.path === "/api/subscribers") {
					smoke.child?.kill("SIGTERM");
					await Bun.sleep(300);
				}
			});
			const run = startSmoke(directory, fullSmoke(local.url));
			smoke.child = run.child;

			const result = await run.result;

			expect(result.exitCode, result.output).toBe(143);
			expect(createdIds(local, "/api/subscribers")).toEqual([4242]);
			expect(requestCount(local, "DELETE", "/api/subscribers/4242")).toBe(1);
			expect(requestCount(local, "POST", "/api/templates")).toBe(0);
			expect(await leftoverStateDirectories(directory)).toEqual([]);
		},
		SMOKE_TIMEOUT_MS,
	);

	test(
		"still deletes the remaining fixtures when a signal interrupts cleanup",
		async () => {
			const directory = await temporaryDirectory();
			const smoke: { child?: Bun.Subprocess; signaled?: boolean } = {};
			// Signal the script during the first subscriber delete of the normal
			// cleanup; the template delete is still pending at that point.
			const local = startFakeListmonk(TOKEN, async (request) => {
				if (
					request.method === "DELETE" &&
					request.path.startsWith("/api/subscribers/") &&
					!smoke.signaled
				) {
					smoke.signaled = true;
					smoke.child?.kill("SIGTERM");
					await Bun.sleep(300);
				}
			});
			const run = startSmoke(directory, fullSmoke(local.url));
			smoke.child = run.child;

			const result = await run.result;

			expect(result.exitCode, result.output).toBe(143);
			expect(smoke.signaled).toBe(true);
			const [subscriberId] = createdIds(local, "/api/subscribers");
			const [templateId] = createdIds(local, "/api/templates");
			expect(
				requestCount(local, "DELETE", `/api/subscribers/${subscriberId}`),
			).toBeGreaterThanOrEqual(1);
			expect(requestCount(local, "DELETE", `/api/templates/${templateId}`)).toBe(
				1,
			);
			expect(await leftoverStateDirectories(directory)).toEqual([]);
		},
		SMOKE_TIMEOUT_MS,
	);

	test(
		"retries a failed fixture delete from exit cleanup",
		async () => {
			const directory = await temporaryDirectory();
			let failedSubscriberDelete = false;
			const local = startFakeListmonk(TOKEN, (request) => {
				if (
					!failedSubscriberDelete &&
					request.method === "DELETE" &&
					request.path.startsWith("/api/subscribers/")
				) {
					failedSubscriberDelete = true;
					return Response.json(
						{ message: "temporary delete failure" },
						{ status: 503 },
					);
				}
			});

			const result = await runSmoke(directory, fullSmoke(local.url));

			const [subscriberId] = createdIds(local, "/api/subscribers");
			const [templateId] = createdIds(local, "/api/templates");
			expect(result.exitCode, result.output).toBe(1);
			expect(result.stdout).toContain("FAIL subscribers_delete");
			expect(
				requestCount(local, "DELETE", `/api/subscribers/${subscriberId}`),
			).toBe(2);
			expect(
				requestCount(local, "DELETE", `/api/templates/${templateId}`),
			).toBe(1);
			expect(await leftoverStateDirectories(directory)).toEqual([]);
		},
		SMOKE_TIMEOUT_MS,
	);

	test(
		"gives concurrent runs in the same second distinct fixtures",
		async () => {
			const stubDirectory = await temporaryDirectory();
			const realDate = Bun.which("date");
			if (realDate === null) {
				throw new Error("date is required");
			}
			// Both runs see the same `date +%s`, like runs started in one second.
			await writeFile(
				join(stubDirectory, "date"),
				`#!/usr/bin/env bash\nif [[ "$*" == "+%s" ]]; then echo 1790000000; exit 0; fi\nexec "${realDate}" "$@"\n`,
			);
			await chmod(join(stubDirectory, "date"), 0o755);
			const local = startFakeListmonk(TOKEN);
			const usernames = ["smoke-run-a", "smoke-run-b"];

			// Like default invocations, both runs share one log directory.
			await Promise.all(
				usernames.map(async (username) =>
					runSmoke(await temporaryDirectory(), {
						...fullSmoke(local.url, username),
						PATH: `${stubDirectory}${delimiter}${process.env.PATH ?? ""}`,
						LISTMONK_OPS_SMOKE_LOG_DIR: join(stubDirectory, "logs"),
					}),
				),
			);

			const createBodies = (path: string) =>
				usernames.map((username) =>
					local.requests
						.filter(
							(request) =>
								request.method === "POST" &&
								request.path === path &&
								request.authorization === `token ${username}:${TOKEN}`,
						)
						.map((request) => JSON.parse(request.body) as Record<string, unknown>),
				);
			const [emailsA, emailsB] = createBodies("/api/subscribers").map((bodies) =>
				bodies.map((body) => body.email),
			);
			expect(emailsA).toHaveLength(1);
			expect(emailsB).toHaveLength(1);
			expect(emailsA).not.toEqual(emailsB);
			const [namesA, namesB] = createBodies("/api/templates").map((bodies) =>
				bodies.map((body) => body.name),
			);
			expect(namesA).not.toEqual(namesB);
			// Each run created its own subscriber and deleted only that one.
			for (const username of usernames) {
				const [subscriberId] = createdIds(local, "/api/subscribers", username);
				expect(subscriberId).toBeNumber();
				expect(
					local.requests
						.filter(
							(request) =>
								request.method === "DELETE" &&
								request.path.startsWith("/api/subscribers/") &&
								request.authorization === `token ${username}:${TOKEN}`,
						)
						.map((request) => request.path),
				).toEqual([`/api/subscribers/${subscriberId}`]);
			}
		},
		SMOKE_TIMEOUT_MS,
	);

	test(
		"binds fixtures from private create output, not the shared log directory",
		async () => {
			const directory = await temporaryDirectory();
			// Stand in for a concurrent run overwriting create output in the shared
			// log directory: anything written to these paths there is discarded.
			for (const step of ["subscribers_create", "templates_create", "abtest_create"]) {
				await symlink("/dev/null", join(directory, "logs", `${step}.json`));
			}
			const local = startFakeListmonk(TOKEN);

			const result = await runSmoke(directory, fullSmoke(local.url));

			const [subscriberId] = createdIds(local, "/api/subscribers");
			const [templateId] = createdIds(local, "/api/templates");
			expect(result.stdout, result.output).not.toContain(
				"no record created by this run",
			);
			expect(
				requestCount(local, "DELETE", `/api/subscribers/${subscriberId}`),
			).toBe(1);
			expect(requestCount(local, "DELETE", `/api/templates/${templateId}`)).toBe(
				1,
			);
			// The step log keeps the create output for debugging.
			expect(
				await readFile(join(directory, "logs", "subscribers_create.log"), "utf8"),
			).toContain(`"id": ${subscriberId}`);
			expect(await leftoverStateDirectories(directory)).toEqual([]);
		},
		SMOKE_TIMEOUT_MS,
	);
});
