import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { getOpsStorePaths } from "../src/core";
import { getOutboundWebhookStorePath } from "../src/outbound-webhooks";
import { getSequenceStorePath } from "../src/sequences";

const STORE_VARIABLES = [
	"LISTMONK_OPS_SEGMENT_STORE",
	"LISTMONK_OPS_TEMPLATE_REGISTRY",
	"LISTMONK_OPS_SEQUENCE_STORE",
	"LISTMONK_OPS_WEBHOOK_STORE",
] as const;
const previousValues = Object.fromEntries(
	STORE_VARIABLES.map((name) => [name, process.env[name]]),
);
const directories: string[] = [];

afterEach(async () => {
	for (const name of STORE_VARIABLES) {
		const previous = previousValues[name];
		if (previous === undefined) delete process.env[name];
		else process.env[name] = previous;
	}
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("automation store path overrides", () => {
	test("expand ~/ and resolve relative overrides from the home directory", () => {
		process.env.LISTMONK_OPS_SEGMENT_STORE = "~/state/segment-drift.json";
		process.env.LISTMONK_OPS_TEMPLATE_REGISTRY =
			"  state/template-registry.json  ";
		process.env.LISTMONK_OPS_SEQUENCE_STORE = "~/state/sequences.json";
		process.env.LISTMONK_OPS_WEBHOOK_STORE =
			" /srv/listmonk-ops/outbound-webhooks.json ";

		expect(getOpsStorePaths()).toEqual({
			segmentStorePath: join(homedir(), "state", "segment-drift.json"),
			templateRegistryPath: join(homedir(), "state", "template-registry.json"),
		});
		expect(getSequenceStorePath()).toBe(
			join(homedir(), "state", "sequences.json"),
		);
		expect(getOutboundWebhookStorePath()).toBe(
			"/srv/listmonk-ops/outbound-webhooks.json",
		);
	});

	test("runtime repositories write environment-configured stores under home, not the cwd", async () => {
		const home = await mkdtemp(join(tmpdir(), "listmonk-ops-store-home-"));
		const cwd = await mkdtemp(join(tmpdir(), "listmonk-ops-store-cwd-"));
		directories.push(home, cwd);
		const moduleUrl = (path: string) =>
			JSON.stringify(new URL(path, import.meta.url).href);
		const script = `
			const { getSequenceRepositoryFromEnvironment } = await import(${moduleUrl("../src/sequence-runtime.ts")});
			const { createSequenceDefinition } = await import(${moduleUrl("../src/sequences.ts")});
			const { getOutboundWebhookStoreOptionsFromEnvironment } = await import(${moduleUrl("../src/outbound-webhook-runtime.ts")});
			await getSequenceRepositoryFromEnvironment().createDefinition(
				createSequenceDefinition(
					{ name: "path-probe", steps: [{ id: "stop", type: "stop" }] },
					new Date("2026-08-01T09:00:00.000Z"),
				),
			);
			await getOutboundWebhookStoreOptionsFromEnvironment().repository.getOrCreateProbeIdKey();
		`;
		const child = Bun.spawn([process.execPath, "-e", script], {
			cwd,
			env: {
				...process.env,
				HOME: home,
				LISTMONK_OPS_SEQUENCE_STORE: "~/state/sequences.json",
				LISTMONK_OPS_WEBHOOK_STORE: "state/outbound-webhooks.json",
				LISTMONK_OPS_SEQUENCE_DATABASE_URL: "",
				LISTMONK_OPS_WEBHOOK_DATABASE_URL: "",
			},
			stdout: "ignore",
			stderr: "pipe",
		});
		const [stderr, code] = await Promise.all([
			new Response(child.stderr).text(),
			child.exited,
		]);
		if (code !== 0) throw new Error(`store subprocess failed: ${stderr}`);

		expect((await stat(join(home, "state", "sequences.json"))).isFile()).toBe(
			true,
		);
		expect(
			(await stat(join(home, "state", "outbound-webhooks.json"))).isFile(),
		).toBe(true);
		expect(await readdir(cwd)).toEqual([]);
	});
});
