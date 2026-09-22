import { afterAll, describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch(request) {
		const path = new URL(request.url).pathname;
		if (path === "/health") return Response.json({ data: true });
		if (request.headers.get("authorization") !== "token status-test:valid") return Response.json({ message: "secret remote details" }, { status: 403 });
		if (path === "/api/about") return Response.json({ data: { version: "v6.2.0" } });
		if (path === "/api/subscribers") return Response.json({ message: "forbidden" }, { status: 403 });
		return Response.json({ data: { results: [] } });
	},
});
afterAll(() => server.stop(true));

async function status(token: string, flags: string[]) {
	const binary = process.env.CLI_TEST_EXECUTABLE?.trim();
	const args = ["status", "--format=json", ...flags];
	const child = Bun.spawn(
		binary ? [binary, ...args] : ["bun", "src/index.ts", ...args],
		{
			cwd: cliDirectory,
			env: {
				...process.env,
				LISTMONK_API_URL: `http://127.0.0.1:${server.port}/api`,
				LISTMONK_USERNAME: "status-test",
				LISTMONK_API_TOKEN: token,
				BUN_FORCE_COLOR: "0",
			},
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { output: JSON.parse(stdout), stderr, exitCode };
}

describe("CLI status check", () => {
	test("returns structured failure and nonzero for rejected credentials despite healthy public endpoint", async () => {
		const result = await status("invalid", ["--check"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe("");
		expect(result.output.listmonk.health.state).toBe("ok");
		expect(result.output.listmonk.authentication.state).toBe("denied");
		expect(JSON.stringify(result.output)).not.toContain("secret remote details");
	});
	test("reports diagnostics without failing the command when --check is omitted", async () => {
		const result = await status("invalid", []);
		expect(result.exitCode).toBe(0);
		expect(result.output.readiness.listmonk).toBe(false);
	});
	test("checks selected read access independently of authentication", async () => {
		const allowed = await status("valid", ["--check", "--permissions=lists,campaigns"]);
		expect(allowed.exitCode).toBe(0);
		expect(allowed.output.listmonk.permissions).toHaveLength(2);
		const denied = await status("valid", ["--check", "--permissions=subscribers"]);
		expect(denied.exitCode).toBe(1);
		expect(denied.output.listmonk.authentication.state).toBe("ok");
		expect(denied.output.listmonk.permissions[0].state).toBe("denied");
	});
	test("reports missing credentials without losing public connectivity diagnostics", async () => {
		const result = await status("", ["--check"]);
		expect(result.exitCode).toBe(1);
		expect(result.output.target.auth).toBe("none");
		expect(result.output.listmonk.connectivity).toBe("reachable");
		expect(result.output.listmonk.authentication.state).toBe("not_checked");
	});
});
