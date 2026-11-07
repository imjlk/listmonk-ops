import { afterAll, describe, expect, test } from "bun:test";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(tmpdir(), "campaign-review-cli-"));
const calls: string[] = [];
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
 const path = new URL(request.url).pathname;
 calls.push(`${request.method} ${path}`);
 if (request.method !== "GET") return new Response("Mutations forbidden", { status: 405 });
 if (path === "/api/campaigns/42/preview") return new Response("<p>Preview</p>", { headers: { "content-type": "text/html" } });
 if (path === "/api/campaigns/42") return Response.json({ data: { id: 42, uuid: "review-uuid", updated_at: "r1", name: "Review", subject: "Hello", body: "Body", status: "draft", lists: [{ id: 7 }] } });
 if (path === "/api/lists/7") return Response.json({ data: { id: 7, name: "Audience", subscriber_count: 10 } });
 return new Response("Not found", { status: 404 });
} });
afterAll(async () => {
	await server.stop(true);
	rmSync(directory, { recursive: true, force: true });
});
async function run(args: string[]) {
	const child = Bun.spawn(
		[
			"bun",
			"src/index.ts",
			"ops",
			"campaign-review",
			"--campaign-id",
			"42",
			"--format",
			"json",
			...args,
		],
		{
			cwd: cliDirectory,
			env: {
				...process.env,
				BUN_FORCE_COLOR: "0",
				LISTMONK_API_URL: `http://127.0.0.1:${server.port}/api`,
				LISTMONK_USERNAME: "review-test",
				LISTMONK_API_TOKEN: "test-token",
				LISTMONK_OPS_AUDIT_STORE: join(directory, "audit.json"),
			},
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout, stderr, code };
}
describe("campaign review CLI", () => {
	test("exports private snapshot and compares it without sending or overwriting", async () => {
		const path = join(directory, "review.json");
		const first = await run(["--snapshot-output", path]);
		expect(first.code).toBe(0);
		expect(first.stderr).toBe("");
		const result = JSON.parse(first.stdout);
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(result.snapshot);
		if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
		const compare = await run(["--compare", path]);
		expect(compare.code).toBe(0);
		expect(JSON.parse(compare.stdout).comparison).toEqual({
			compared: true,
			changed_fields: [],
			messages: [],
		});
		const saved = readFileSync(path, "utf8");
		expect((await run(["--snapshot-output", path])).code).not.toBe(0);
		expect(readFileSync(path, "utf8")).toBe(saved);
		expect(calls.every((call) => call.startsWith("GET "))).toBe(true);
		expect(calls.some((call) => /status|test|subscribers/.test(call))).toBe(
			false,
		);
	}, 20000);
	test("rejects malformed and oversized snapshot files before remote reads", async () => {
		const invalid = join(directory, "invalid.json");
		writeFileSync(invalid, "{secret-invalid");
		const large = join(directory, "large.json");
		writeFileSync(large, "x".repeat(262145));
		const before = calls.length;
		for (const path of [invalid, large]) expect((await run(["--compare", path])).code).not.toBe(0);
		expect(calls.length).toBe(before);
	}, 15000);
});
