import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const bootstrap = resolve(import.meta.dir, "bootstrap-listmonk-test-auth.ts");

function ipv6LoopbackAvailable(): boolean {
	try {
		Bun.serve({ hostname: "::1", port: 0, fetch: () => new Response() }).stop(
			true,
		);
		return true;
	} catch {
		return false;
	}
}

/** Run the bootstrap with a minimal environment: no GITHUB_ENV or operator shell. */
async function runBootstrap(directory: string, apiUrl: string) {
	const child = Bun.spawn(["bun", bootstrap], {
		env: {
			PATH: process.env.PATH ?? "",
			HOME: directory,
			LISTMONK_API_URL: apiUrl,
			LISTMONK_USERNAME: "api-admin",
			LISTMONK_API_TOKEN: "test-token",
			LISTMONK_TEST_TOKEN_FILE: join(directory, "token"),
		},
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

describe("local test-auth bootstrap target guard", () => {
	test("refuses a non-local API URL before any request", async () => {
		const directory = await mkdtemp(join(tmpdir(), "listmonk-bootstrap-"));
		try {
			const result = await runBootstrap(
				directory,
				"https://listmonk.example.invalid/api",
			);

			expect(result.exitCode).not.toBe(0);
			expect(result.stderr).toContain(
				"Refusing to bootstrap credentials for non-local URL https://listmonk.example.invalid/api",
			);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test.skipIf(!ipv6LoopbackAvailable())(
		"validates a token on a bracketed IPv6 loopback URL",
		async () => {
			const directory = await mkdtemp(join(tmpdir(), "listmonk-bootstrap-"));
			const requests: string[] = [];
			const server = Bun.serve({
				hostname: "::1",
				port: 0,
				fetch(request) {
					const url = new URL(request.url);
					requests.push(`${request.method} ${url.pathname}${url.search}`);
					return request.headers.get("authorization") ===
						"token api-admin:test-token"
						? Response.json({ data: { results: [] } })
						: Response.json({ message: "Invalid API token" }, { status: 403 });
				},
			});
			try {
				const result = await runBootstrap(
					directory,
					`http://[::1]:${server.port}/api`,
				);

				expect(result.exitCode, result.stderr).toBe(0);
				expect(result.stdout).toContain(
					"Validated Listmonk API token for api-admin",
				);
				expect(requests).toEqual(["GET /api/lists?page=1&per_page=1"]);
				expect(await readFile(join(directory, "token"), "utf8")).toBe(
					"test-token\n",
				);
			} finally {
				server.stop(true);
				await rm(directory, { recursive: true, force: true });
			}
		},
	);
});
