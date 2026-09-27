import { describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readWorkspaces } from "./check-cli-npm-install";
import {
	findModuleSpecifiers,
	resolveDeclarationSpecifier,
	rewriteDeclarationDirectory,
	rewriteDeclarationSource,
} from "./rewrite-declaration-specifiers";

const DIST = "/package/dist";

function fileSet(...paths: string[]): (path: string) => boolean {
	const files = new Set(paths.map((path) => join(DIST, path)));
	return (path) => files.has(path);
}

function specifierValues(source: string): string[] {
	return findModuleSpecifiers(source).map(({ value }) => value);
}

describe("module specifier scanning", () => {
	test("finds every declaration form that names a module", () => {
		const source = [
			'import { a } from "./a";',
			"import type { B } from './b';",
			'import "./side-effect";',
			'export * from "./star";',
			'export * as namespace from "./namespace";',
			'export { c, type D } from "./c";',
			'export declare const e: import("./e").E;',
			'export declare const f: typeof import("..");',
			'import g = require("./g");',
			'declare module "./augmented" {}',
			'import { z } from "zod";',
		].join("\n");
		expect(specifierValues(source)).toEqual([
			"./a",
			"./b",
			"./side-effect",
			"./star",
			"./namespace",
			"./c",
			"./e",
			"..",
			"./g",
			"./augmented",
			"zod",
		]);
		for (const { value, start, end } of findModuleSpecifiers(source)) {
			expect(source.slice(start, end)).toBe(value);
		}
	});

	test("skips comments, string literal types, templates, and attributes", () => {
		const source = [
			"// import { a } from './line-comment';",
			"/**",
			' * @example import { b } from "./jsdoc";',
			" */",
			'export type Path = "./literal" | `./template/${"./nested"}`;',
			"export type Nested = `${`${string}/x`}-${number}`;",
			"export type Escaped = 'it\\'s from \"./escaped\"';",
			'import data from "./data.json" with { type: "json" };',
			"export declare const from: string;",
			'export { after } from "./after-template";',
		].join("\n");
		expect(specifierValues(source)).toEqual([
			"./data.json",
			"./after-template",
		]);
	});
});

describe("declaration specifier resolution", () => {
	const declaration = join(DIST, "src/client/index.d.ts");
	const exists = fileSet(
		"src/client/crud.d.ts",
		"src/client/transport.d.ts",
		"src/client/transport/index.d.ts",
		"src/client/runtime/index.d.ts",
		"src/client/types.gen.d.ts",
		"src/client/module.d.mts",
		"src/client/data.json",
		"src/index.d.ts",
		"sdk.d.ts",
		"generated/index.d.ts",
	);
	const resolveFrom = (specifier: string, from = declaration) =>
		resolveDeclarationSpecifier(from, specifier, exists);

	test("names the runtime file of an extensionless declaration", () => {
		expect(resolveFrom("./crud")).toBe("./crud.js");
		expect(resolveFrom("./types.gen")).toBe("./types.gen.js");
		expect(resolveFrom("../../sdk")).toBe("../../sdk.js");
	});

	test("resolves directories to their index, after sibling files", () => {
		expect(resolveFrom("./runtime")).toBe("./runtime/index.js");
		expect(resolveFrom("./runtime/")).toBe("./runtime/index.js");
		expect(resolveFrom("../../generated")).toBe("../../generated/index.js");
		expect(resolveFrom("./transport")).toBe("./transport.js");
		expect(resolveFrom("..")).toBe("../index.js");
		expect(resolveFrom(".", join(DIST, "src/client/runtime/types.d.ts"))).toBe(
			"./index.js",
		);
	});

	test("keeps specifiers that already resolve under node16", () => {
		expect(resolveFrom("./crud.js")).toBe("./crud.js");
		expect(resolveFrom("./module.mjs")).toBe("./module.mjs");
		expect(resolveFrom("./data.json")).toBe("./data.json");
		expect(resolveFrom("zod")).toBe("zod");
		expect(resolveFrom("node:crypto")).toBe("node:crypto");
		expect(resolveFrom("@listmonk-ops/operations/specs")).toBe(
			"@listmonk-ops/operations/specs",
		);
	});

	test("maps TypeScript source extensions to runtime extensions", () => {
		expect(resolveFrom("./crud.ts")).toBe("./crud.js");
		expect(resolveFrom("./module.mts")).toBe("./module.mjs");
	});

	test("reports specifiers that name no emitted file", () => {
		expect(resolveFrom("./missing")).toBeUndefined();
		expect(resolveFrom("./missing.js")).toBeUndefined();
		expect(resolveFrom("./crud/")).toBeUndefined();
	});
});

describe("declaration source rewriting", () => {
	const declaration = join(DIST, "index.d.ts");
	const exists = fileSet("client.d.ts", "generated/index.d.ts", "types.gen.d.ts");

	test("rewrites relative specifiers in place and preserves quotes", () => {
		const source = [
			'export * from "./client";',
			"export type { Options } from './types.gen';",
			'export declare const sdk: typeof import("./generated");',
			'export { z } from "zod";',
			'// export * from "./client";',
		].join("\n");
		const result = rewriteDeclarationSource(source, declaration, exists);
		expect(result.text).toBe(
			[
				'export * from "./client.js";',
				"export type { Options } from './types.gen.js';",
				'export declare const sdk: typeof import("./generated/index.js");',
				'export { z } from "zod";',
				'// export * from "./client";',
			].join("\n"),
		);
		expect(result.rewritten).toBe(3);
		expect(result.unresolved).toEqual([]);

		const again = rewriteDeclarationSource(result.text, declaration, exists);
		expect(again.text).toBe(result.text);
		expect(again.rewritten).toBe(0);
	});

	test("collects unresolved specifiers without rewriting them", () => {
		const result = rewriteDeclarationSource(
			'export * from "./client";\nexport * from "./removed";',
			declaration,
			exists,
		);
		expect(result.text).toBe(
			'export * from "./client.js";\nexport * from "./removed";',
		);
		expect(result.unresolved).toEqual(["./removed"]);
	});
});

describe("declaration directory rewriting", () => {
	function withDist(
		files: Record<string, string>,
		run: (directory: string) => void,
	): void {
		const directory = mkdtempSync(join(tmpdir(), "listmonk-declarations-"));
		try {
			for (const [path, contents] of Object.entries(files)) {
				mkdirSync(dirname(join(directory, path)), { recursive: true });
				writeFileSync(join(directory, path), contents);
			}
			run(directory);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}

	test("rewrites every declaration file once and leaves other files", () => {
		withDist(
			{
				"index.d.ts": 'export * from "./client";\nexport * from "./specs";\n',
				"index.js": 'export * from "./client";\n',
				"client.d.ts": 'export type { Spec } from "./specs/spec";\n',
				"specs/index.d.ts": 'export * from "./spec";\n',
				"specs/spec.d.ts": 'export type Spec = import("..").Client;\n',
			},
			(directory) => {
				expect(rewriteDeclarationDirectory(directory)).toEqual({
					files: 4,
					rewrittenFiles: 4,
					specifiers: 5,
				});
				const read = (path: string) =>
					readFileSync(join(directory, path), "utf8");
				expect(read("index.d.ts")).toBe(
					'export * from "./client.js";\nexport * from "./specs/index.js";\n',
				);
				expect(read("specs/spec.d.ts")).toBe(
					'export type Spec = import("../index.js").Client;\n',
				);
				expect(read("index.js")).toBe('export * from "./client";\n');

				expect(rewriteDeclarationDirectory(directory)).toEqual({
					files: 4,
					rewrittenFiles: 0,
					specifiers: 0,
				});
			},
		);
	});

	test("writes nothing when a specifier names a file that was not emitted", () => {
		withDist(
			{
				"index.d.ts": 'export * from "./client";\n',
				"client.d.ts": 'export * from "./missing";\n',
			},
			(directory) => {
				expect(() => rewriteDeclarationDirectory(directory)).toThrow(
					'client.d.ts: "./missing"',
				);
				expect(readFileSync(join(directory, "index.d.ts"), "utf8")).toBe(
					'export * from "./client";\n',
				);
			},
		);
	});

	test("rejects a directory without declarations", () => {
		withDist({ "index.js": "export {};\n" }, (directory) => {
			expect(() => rewriteDeclarationDirectory(directory)).toThrow(
				"No declaration files found",
			);
		});
	});
});

test("published libraries rewrite their declarations after emitting them", () => {
	// Libraries compile with bundler resolution and publish an exports map; the
	// MCP server's own sources already import sibling modules with `.js`.
	const libraries = [...readWorkspaces().values()].filter(
		({ manifest }) => !manifest.private && manifest.exports !== undefined,
	);
	expect(libraries.length).toBeGreaterThan(0);
	const missing = libraries.flatMap(({ manifest }) => {
		const steps = (manifest.scripts?.build ?? "")
			.split("&&")
			.map((step) => step.trim());
		const lastDeclarationEmit = steps.findLastIndex((step) =>
			/^ttsc\b/.test(step),
		);
		const rewrite = steps.indexOf(
			"bun ../../scripts/rewrite-declaration-specifiers.ts dist",
		);
		return lastDeclarationEmit >= 0 && rewrite > lastDeclarationEmit
			? []
			: [manifest.name];
	});
	expect(missing).toEqual([]);
});
