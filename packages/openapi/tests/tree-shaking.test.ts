import { describe, expect, test } from "bun:test";
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Includes bounded delivery overrides (messenger, subject, content type, and
// alternate body) while preserving a narrow single-endpoint Worker surface.
const runtimeBundleBudgetBytes = 23_250;

async function buildRuntimeArtifact(): Promise<void> {
	await build({
		bundle: true,
		entryPoints: [resolve(packageDirectory, "runtime.ts")],
		format: "esm",
		logLevel: "silent",
		minify: true,
		outfile: resolve(packageDirectory, "dist/runtime.js"),
		platform: "browser",
	});
}

async function bundleConsumer(contents: string): Promise<string> {
	const result = await build({
		stdin: {
			contents,
			loader: "ts",
			resolveDir: packageDirectory,
			sourcefile: "tree-shaking-consumer.ts",
		},
		bundle: true,
		format: "esm",
		logLevel: "silent",
		minify: true,
		platform: "browser",
		treeShaking: true,
		write: false,
	});
	const output = result.outputFiles[0];
	if (!output) throw new Error("esbuild did not produce a consumer bundle");
	return output.text;
}

function generatedEndpointUrls(bundle: string): string[] {
	return [
		...new Set(
			Array.from(bundle.matchAll(/url:"([^"]+)"/g), (match) => match[1]),
		),
	].sort();
}

describe("OpenAPI consumer tree-shaking", () => {
	test("keeps the raw client factory free of generated endpoints", async () => {
		const bundle = await bundleConsumer(`
			import { createClient } from "./index.ts";
			globalThis.__treeShakingProbe = createClient;
		`);

		expect(generatedEndpointUrls(bundle)).toEqual([]);
		expect(Buffer.byteLength(bundle)).toBeLessThan(12_000);
	});

	test("drops endpoints that the enhanced client does not expose", async () => {
		const bundle = await bundleConsumer(`
			import { createListmonkClient } from "./index.ts";
			globalThis.__treeShakingProbe = createListmonkClient;
		`);
		const urls = generatedEndpointUrls(bundle);

		expect(urls).toHaveLength(43);
		expect(urls).toContain("/lists");
		expect(urls).not.toContain("/lang/{lang}");
		expect(urls).not.toContain("/maintenance/analytics/{type}");
		expect(urls).not.toContain("/public/subscription");
		expect(Buffer.byteLength(bundle)).toBeLessThan(30_000);
	});

	test("keeps a single raw SDK operation isolated", async () => {
		const bundle = await bundleConsumer(`
			import { getLists } from "./sdk.ts";
			globalThis.__treeShakingProbe = getLists;
		`);

		expect(generatedEndpointUrls(bundle)).toEqual(["/lists"]);
		expect(Buffer.byteLength(bundle)).toBeLessThan(12_000);
	});

	test("keeps the Workers runtime helper limited to transactional delivery", async () => {
		const bundle = await bundleConsumer(`
			import { createListmonkRuntimeClient, sendExternalTransactionalEmail } from "./runtime.ts";
			globalThis.__treeShakingProbe = { createListmonkRuntimeClient, sendExternalTransactionalEmail };
		`);

		expect(generatedEndpointUrls(bundle)).toEqual(["/tx"]);
		// Keep the opaque client and bounded payload validation within a small
		// Worker entrypoint while retaining only the transactional endpoint.
		expect(Buffer.byteLength(bundle)).toBeLessThan(runtimeBundleBudgetBytes);
	});

	test("exposes the same bounded helper through the built runtime subpath", async () => {
		await buildRuntimeArtifact();
		const runtimePath = await Bun.resolve(
			"@listmonk-ops/openapi/runtime",
			packageDirectory,
		);
		expect(runtimePath).toBe(resolve(packageDirectory, "dist/runtime.js"));
		const runtime = await import(runtimePath);
		expect(Object.keys(runtime).sort()).toEqual([
			"ListmonkRuntimeError",
			"createListmonkRuntimeClient",
			"createListmonkTokenAuthorization",
			"normalizeListmonkApiBaseUrl",
			"sendExternalTransactionalEmail",
		]);

		const bundle = await bundleConsumer(`
			import { createListmonkRuntimeClient, sendExternalTransactionalEmail } from "@listmonk-ops/openapi/runtime";
			globalThis.__treeShakingProbe = { createListmonkRuntimeClient, sendExternalTransactionalEmail };
		`);
		expect(generatedEndpointUrls(bundle)).toEqual(["/tx"]);
		expect(Buffer.byteLength(bundle)).toBeLessThan(runtimeBundleBudgetBytes);
	});
});
