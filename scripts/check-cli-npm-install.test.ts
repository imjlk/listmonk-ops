import { describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
	CLI_PACKAGE_NAME,
	collectWorkspaceClosure,
	findInstalledWorkspaceCopies,
	isPublishedBundleCommand,
	parseBundlerExternals,
	readWorkspaces,
	requireWorkspace,
	WORKSPACE_SCOPE,
	workspaceRuntimeDependencies,
	type Workspace,
	type WorkspaceManifest,
} from "./check-cli-npm-install";

interface BundleImport {
	path: string;
	external?: boolean;
}

const workspaces = readWorkspaces();
const cli = requireWorkspace(workspaces, CLI_PACKAGE_NAME);

function fixtureWorkspace(manifest: WorkspaceManifest): [string, Workspace] {
	return [manifest.name, { directory: `/fixture/${manifest.name}`, manifest }];
}

function packageName(specifier: string): string {
	return specifier.split("/").slice(0, 2).join("/");
}

describe("bundler command parsing", () => {
	test("reads bun and esbuild external flags", () => {
		expect(
			parseBundlerExternals(
				"bun build src/index.ts --external zod --external=postgres --outdir=dist",
			),
		).toEqual(["zod", "postgres"]);
		expect(
			parseBundlerExternals(
				"esbuild src/index.ts --bundle --external:@listmonk-ops/common --minify",
			),
		).toEqual(["@listmonk-ops/common"]);
		expect(parseBundlerExternals("bun build src/index.ts")).toEqual([]);
	});

	test("recognizes published bundles but not native binaries or wrappers", () => {
		expect(
			isPublishedBundleCommand(
				"bun run clean && ttsc --emitDeclarationOnly && esbuild src/index.ts --bundle",
			),
		).toBe(true);
		expect(isPublishedBundleCommand("bun build src/index.ts --target=bun")).toBe(
			true,
		);
		expect(
			isPublishedBundleCommand("bun build src/index.ts --compile --minify"),
		).toBe(false);
		expect(
			isPublishedBundleCommand("bun run build:js && bun run build:bin"),
		).toBe(false);
		expect(isPublishedBundleCommand("ttsc")).toBe(false);
	});
});

describe("workspace dependency closure", () => {
	test("follows runtime dependencies but not development dependencies", () => {
		const fixture = new Map([
			fixtureWorkspace({
				name: "@listmonk-ops/cli",
				version: "1.0.0",
				dependencies: { "@listmonk-ops/automation": "workspace:^1.0.0", zod: "4.0.0" },
			}),
			fixtureWorkspace({
				name: "@listmonk-ops/automation",
				version: "1.0.0",
				dependencies: { "@listmonk-ops/operations": "workspace:^1.0.0" },
			}),
			fixtureWorkspace({ name: "@listmonk-ops/operations", version: "1.0.0" }),
			fixtureWorkspace({ name: "@listmonk-ops/mcp", version: "1.0.0" }),
		]);
		expect(collectWorkspaceClosure("@listmonk-ops/cli", fixture)).toEqual([
			"@listmonk-ops/automation",
			"@listmonk-ops/cli",
			"@listmonk-ops/operations",
		]);
		expect(() =>
			collectWorkspaceClosure("@listmonk-ops/missing", fixture),
		).toThrow("@listmonk-ops/missing is not a workspace package");
	});

	test("packs every shared runtime package the published CLI imports", () => {
		expect(collectWorkspaceClosure(CLI_PACKAGE_NAME, workspaces)).toEqual([
			"@listmonk-ops/abtest",
			"@listmonk-ops/automation",
			"@listmonk-ops/cli",
			"@listmonk-ops/common",
			"@listmonk-ops/openapi",
			"@listmonk-ops/operations",
		]);
	});
});

describe("installed copy detection", () => {
	test("reports hoisted and nested copies of a workspace package", async () => {
		const project = mkdtempSync(join(tmpdir(), "listmonk-installed-copies-"));
		const writeManifest = (directory: string, name: string) => {
			mkdirSync(directory, { recursive: true });
			writeFileSync(join(directory, "package.json"), JSON.stringify({ name }));
		};
		try {
			const hoisted = join(project, "node_modules/@listmonk-ops/operations");
			const nested = join(
				project,
				"node_modules/@listmonk-ops/automation/node_modules/@listmonk-ops/operations",
			);
			writeManifest(hoisted, "@listmonk-ops/operations");
			writeManifest(nested, "@listmonk-ops/operations");
			writeManifest(
				join(project, "node_modules/@listmonk-ops/automation"),
				"@listmonk-ops/automation",
			);
			writeManifest(join(project, "node_modules/zod"), "zod");

			const copies = await findInstalledWorkspaceCopies(project);
			expect([...copies.keys()].sort()).toEqual([
				"@listmonk-ops/automation",
				"@listmonk-ops/operations",
			]);
			expect(copies.get("@listmonk-ops/operations")).toEqual(
				[hoisted, nested].sort(),
			);
		} finally {
			rmSync(project, { recursive: true, force: true });
		}
	});
});

describe("published package shape", () => {
	test("published bundles keep every @listmonk-ops dependency external", () => {
		const inlined: string[] = [];
		for (const { manifest } of workspaces.values()) {
			if (manifest.private) {
				continue;
			}
			for (const [script, command] of Object.entries(manifest.scripts ?? {})) {
				if (!isPublishedBundleCommand(command)) {
					continue;
				}
				const externals = parseBundlerExternals(command);
				for (const dependency of workspaceRuntimeDependencies(manifest)) {
					if (!externals.includes(dependency)) {
						inlined.push(`${manifest.name} ${script}: ${dependency}`);
					}
				}
			}
		}
		// A bundled copy of a workspace package has its own classes, so
		// `instanceof` fails against errors thrown by the installed package.
		expect(inlined).toEqual([]);
	});

	test("the CLI JS bundle imports workspace packages instead of inlining them", () => {
		const [runner, subcommand, ...args] = (
			cli.manifest.scripts?.["build:js"] ?? ""
		)
			.trim()
			.split(/\s+/);
		expect([runner, subcommand]).toEqual(["bun", "build"]);

		// Run the published build command itself, redirected to a scratch outdir.
		const outputDirectory = mkdtempSync(join(tmpdir(), "listmonk-cli-bundle-"));
		try {
			const metafilePath = join(outputDirectory, "metafile.json");
			const build = Bun.spawnSync(
				[
					process.execPath,
					"build",
					...args.filter((arg) => !arg.startsWith("--outdir")),
					`--outdir=${join(outputDirectory, "js")}`,
					`--metafile=${metafilePath}`,
				],
				{ cwd: cli.directory, stdout: "pipe", stderr: "pipe" },
			);
			expect(build.stderr.toString()).not.toContain("error:");
			expect(build.exitCode).toBe(0);

			const { inputs } = JSON.parse(readFileSync(metafilePath, "utf8")) as {
				inputs: Record<string, { imports: BundleImport[] }>;
			};
			const inputPaths = Object.keys(inputs).map((path) =>
				resolve(cli.directory, path),
			);
			expect(inputPaths).toContain(join(cli.directory, "src/index.ts"));

			const otherWorkspaces = [...workspaces.values()]
				.filter((workspace) => workspace !== cli)
				.map((workspace) => `${workspace.directory}${sep}`);
			expect(
				inputPaths.filter((path) =>
					otherWorkspaces.some((directory) => path.startsWith(directory)),
				),
			).toEqual([]);

			// External imports resolve from node_modules after npm install, so each
			// one must be a declared runtime dependency of the CLI package.
			const declared = workspaceRuntimeDependencies(cli.manifest);
			const externalWorkspaceImports = new Set(
				Object.values(inputs).flatMap(({ imports }) =>
					imports
						.filter(
							(entry) =>
								entry.external === true &&
								entry.path.startsWith(WORKSPACE_SCOPE),
						)
						.map((entry) => packageName(entry.path)),
				),
			);
			expect(externalWorkspaceImports.size).toBeGreaterThan(0);
			expect(
				[...externalWorkspaceImports].filter(
					(name) => !declared.includes(name),
				),
			).toEqual([]);
		} finally {
			rmSync(outputDirectory, { recursive: true, force: true });
		}
	});

	test("the native CLI binary stays self-contained", () => {
		const buildScript = readFileSync(
			join(cli.directory, "scripts/build-binary.ts"),
			"utf8",
		);
		expect(buildScript).toContain('"--compile"');
		expect(buildScript).not.toContain("--external");
	});

	test("published packages never depend or peer on a TypeScript compiler", () => {
		const offenders = [...workspaces.values()]
			.filter(({ manifest }) => !manifest.private)
			.flatMap(({ manifest }) =>
				(["dependencies", "optionalDependencies", "peerDependencies"] as const)
					.filter((field) => manifest[field]?.typescript !== undefined)
					.map((field) => `${manifest.name} ${field}`),
			);
		expect(offenders).toEqual([]);
	});
});
