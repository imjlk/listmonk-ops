import { describe, expect, test } from "bun:test";
import {
	readWorkspaces,
	type WorkspaceManifest,
} from "./check-cli-npm-install";
import {
	declarationPathFor,
	exportsMapProblems,
	formatMatrix,
	publicEntryPoints,
	publicRuntimeFiles,
	publishedDeclarationProblems,
	RESOLUTION_MODES,
	renderConsumerSource,
	renderConsumerTsconfig,
	TYPESCRIPT_TOOLCHAINS,
	toolchainEntryPoints,
	typeScriptErrors,
	unknownUnsupportedPackages,
} from "./check-package-types";

const published = [...readWorkspaces().values()]
	.map(({ manifest }) => manifest)
	.filter((manifest) => !manifest.private);

function manifest(fields: Partial<WorkspaceManifest>): WorkspaceManifest {
	return { name: "@listmonk-ops/example", version: "1.0.0", ...fields };
}

describe("published exports maps", () => {
	test("every published entry point resolves its declarations first", () => {
		expect(published.flatMap((entry) => exportsMapProblems(entry))).toEqual(
			[],
		);
	});

	test("the check covers every subpath export", () => {
		const entryPoints = published.flatMap((entry) => publicEntryPoints(entry));
		for (const subpath of [
			"@listmonk-ops/openapi",
			"@listmonk-ops/openapi/sdk",
			"@listmonk-ops/openapi/runtime",
			"@listmonk-ops/operations",
			"@listmonk-ops/operations/specs",
			"@listmonk-ops/common",
			"@listmonk-ops/automation",
			"@listmonk-ops/abtest",
			"@listmonk-ops/mcp",
		]) {
			expect(entryPoints).toContain(subpath);
		}
		// The CLI publishes a bin, not declarations.
		expect(entryPoints).not.toContain("@listmonk-ops/cli");
	});

	test("reports conditions that hide or misdescribe declarations", () => {
		expect(
			exportsMapProblems(
				manifest({
					types: "./dist/other.d.ts",
					exports: {
						".": {
							import: "./dist/index.js",
							types: "./dist/index.d.ts",
						},
						"./sdk": { types: "./dist/sdk.js", import: "./dist/sdk.js" },
						"./runtime": {
							types: "./dist/runtime.d.ts",
							import: "./dist/other.js",
						},
						"./*": { types: "./dist/*.d.ts" },
						"./legacy": "./dist/legacy.js",
						"./internal": null,
						"./package.json": "./package.json",
						"./manifest": { default: "./package.json" },
						"./empty": {},
					},
				}),
			),
		).toEqual([
			'@listmonk-ops/example exports["."]: list "types" first (found import, types)',
			'@listmonk-ops/example: top-level "types" ./dist/other.d.ts differs from exports["."] ./dist/index.d.ts',
			'@listmonk-ops/example exports["./sdk"]: "types" must name a declaration file',
			'@listmonk-ops/example exports["./runtime"]: "types" ./dist/runtime.d.ts does not describe "import" ./dist/other.js',
			'@listmonk-ops/example exports["./*"]: expected an explicit subpath such as "./sdk"',
			'@listmonk-ops/example exports["./legacy"]: expected conditions with "types" first',
			'@listmonk-ops/example exports["./empty"]: list "types" first (found none)',
			'@listmonk-ops/example exports["./empty"]: "types" must name a declaration file',
		]);
		expect(exportsMapProblems(manifest({ exports: "./dist/index.js" }))).toEqual(
			['@listmonk-ops/example: "exports" must map subpaths to conditions'],
		);
	});

	test("validates published exports maps that name no declarations", () => {
		expect(
			publishedDeclarationProblems(
				[
					manifest({ exports: { ".": "./dist/index.js" } }),
					manifest({
						name: "@listmonk-ops/private",
						private: true,
						exports: { ".": "./dist/index.js" },
					}),
					manifest({ name: "@listmonk-ops/cli", main: "./dist/js/index.js" }),
				],
				[],
			),
		).toEqual([
			'@listmonk-ops/example exports["."]: expected conditions with "types" first',
		]);
		expect(
			publishedDeclarationProblems(
				[manifest({ types: "./dist/index.d.ts" })],
				[
					{
						typescript: "5.0.4",
						typesNode: "22.13.14",
						unsupported: { packages: ["@listmonk-ops/missing"], reason: "test" },
					},
				],
			),
		).toEqual(["TYPESCRIPT_TOOLCHAINS: @listmonk-ops/missing ships no declarations"]);
		expect(
			publishedDeclarationProblems(
				[...readWorkspaces().values()].map(({ manifest }) => manifest),
			),
		).toEqual([]);
	});

	test("lists the runtime files every entry point needs", () => {
		expect(
			publicRuntimeFiles(
				manifest({
					main: "./dist/index.js",
					exports: {
						".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
						"./specs": {
							types: "./dist/specs/index.d.ts",
							import: "./dist/specs/index.js",
							default: "./dist/specs/index.js",
						},
						"./package.json": "./package.json",
						"./manifest": { default: "./package.json" },
					},
				}),
			),
		).toEqual(["./dist/index.js", "./dist/specs/index.js"]);
		expect(publicRuntimeFiles(manifest({ main: "./dist/index.js" }))).toEqual([
			"./dist/index.js",
		]);
	});

	test("pairs runtime files with their declaration files", () => {
		expect(declarationPathFor("./dist/index.js")).toBe("./dist/index.d.ts");
		expect(declarationPathFor("./dist/index.mjs")).toBe("./dist/index.d.mts");
		expect(declarationPathFor("./dist/index.cjs")).toBe("./dist/index.d.cts");
		expect(declarationPathFor("./dist/data.json")).toBeUndefined();
	});
});

describe("public entry points", () => {
	test("lists subpath exports and falls back to the types field", () => {
		expect(
			publicEntryPoints(
				manifest({
					exports: {
						".": { types: "./dist/index.d.ts" },
						"./specs": { types: "./dist/specs/index.d.ts" },
						"./package.json": "./package.json",
					},
				}),
			),
		).toEqual(["@listmonk-ops/example", "@listmonk-ops/example/specs"]);
		expect(publicEntryPoints(manifest({ types: "./dist/index.d.ts" }))).toEqual(
			["@listmonk-ops/example"],
		);
		expect(publicEntryPoints(manifest({ main: "./dist/index.js" }))).toEqual(
			[],
		);
	});

	test("compilers skip only the packages they name", () => {
		const manifests = [
			manifest({ name: "@listmonk-ops/a", types: "./dist/index.d.ts" }),
			manifest({ name: "@listmonk-ops/b", types: "./dist/index.d.ts" }),
		];
		expect(
			toolchainEntryPoints(
				{
					typescript: "5.0.4",
					typesNode: "22.13.14",
					unsupported: { packages: ["@listmonk-ops/b"], reason: "test" },
				},
				manifests,
			),
		).toEqual(["@listmonk-ops/a"]);
		expect(
			toolchainEntryPoints(
				{ typescript: "5.9.3", typesNode: "26.6.2" },
				manifests,
			),
		).toEqual(["@listmonk-ops/a", "@listmonk-ops/b"]);
	});

	test("unsupported packages name published packages with declarations", () => {
		const withDeclarations = published.filter(
			(entry) => publicEntryPoints(entry).length > 0,
		);
		expect(
			unknownUnsupportedPackages(TYPESCRIPT_TOOLCHAINS, withDeclarations),
		).toEqual([]);
		expect(
			unknownUnsupportedPackages(
				[
					{
						typescript: "5.0.4",
						typesNode: "22.13.14",
						unsupported: { packages: ["@listmonk-ops/cli"], reason: "test" },
					},
				],
				withDeclarations,
			),
		).toEqual(["@listmonk-ops/cli"]);
	});
});

describe("consumer project", () => {
	test("imports every entry point", () => {
		expect(
			renderConsumerSource(["@listmonk-ops/openapi", "@listmonk-ops/openapi/sdk"]),
		).toBe(
			[
				"// Generated by scripts/check-package-types.ts.",
				'import * as entry0 from "@listmonk-ops/openapi";',
				'import * as entry1 from "@listmonk-ops/openapi/sdk";',
				"",
				"export const entryPoints = [entry0, entry1] as const;",
				"",
			].join("\n"),
		);
	});

	test("checks library declarations under each resolution mode", () => {
		expect(RESOLUTION_MODES.map((mode) => mode.moduleResolution)).toEqual([
			"bundler",
			"node16",
			"nodenext",
		]);
		for (const mode of RESOLUTION_MODES) {
			const config = JSON.parse(renderConsumerTsconfig(mode)) as {
				compilerOptions: Record<string, unknown>;
				files: string[];
			};
			expect(config.compilerOptions).toMatchObject({
				module: mode.module,
				moduleResolution: mode.moduleResolution,
				skipLibCheck: false,
				strict: true,
			});
			expect(config.files).toEqual(["consumer.ts"]);
		}
	});

	test("reads compiler errors from tsc output", () => {
		expect(
			typeScriptErrors(
				[
					"node_modules/pkg/dist/index.d.ts(1,15): error TS2834: Relative import paths need explicit file extensions.",
					"  Additional context line",
					"consumer.ts(2,1): error TS2307: Cannot find module 'x'.\r",
					"",
				].join("\n"),
			),
		).toEqual([
			"node_modules/pkg/dist/index.d.ts(1,15): error TS2834: Relative import paths need explicit file extensions.",
			"consumer.ts(2,1): error TS2307: Cannot find module 'x'.",
		]);
	});

	test("summarizes results as a compiler by mode table", () => {
		expect(
			formatMatrix(
				[
					{ typescript: "5.0.4*", mode: "bundler", errors: [] },
					{ typescript: "5.0.4*", mode: "node16", errors: ["e1", "e2"] },
					{
						typescript: "7.0.2",
						mode: "bundler",
						errors: [],
						failure: "tsc crashed",
					},
				],
				["bundler", "node16"],
			),
		).toEqual([
			"TypeScript  bundler  node16",
			"5.0.4*      pass     FAIL (2)",
			"7.0.2       FAIL     -",
		]);
	});
});
