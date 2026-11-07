import { describe, expect, test } from "bun:test";
import {
	existsSync,
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
	type CommandResult,
	collectWorkspaceClosure,
	findInstalledWorkspaceCopies,
	isPublishedBundleCommand,
	type NpmMetadataPolicy,
	npmInstall,
	npmInstallCommand,
	parseBundlerExternals,
	readWorkspaces,
	requireWorkspace,
	shouldRetryWithFreshMetadata,
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

const ETARGET_STDERR = [
	"npm error code ETARGET",
	"npm error notarget No matching version found for @aws-sdk/client-sesv2@^3.1000.0.",
	"npm error notarget In most cases you or one of your dependencies are requesting",
	"npm error notarget a package version that doesn't exist.",
	"npm error A complete log of this run can be found in: /home/ci/.npm/_logs/debug-0.log",
	"",
].join("\n");

function failedInstall(
	stderr: string,
	fields: Partial<CommandResult> = {},
): CommandResult {
	return {
		exitCode: 1,
		signal: null,
		timedOut: false,
		stdout: "",
		stderr,
		...fields,
	};
}

/**
 * Writes an `npm` stand-in that records each invocation's arguments and
 * answers with the stderr and exit status configured for its metadata policy.
 */
function writeFakeNpm(
	directory: string,
	answers: Record<NpmMetadataPolicy, { stderr: string; exitCode: number }>,
): { npm: string; calls: () => string[] } {
	const npm = join(directory, "npm");
	const callsPath = join(directory, "calls.log");
	const branches = Object.entries(answers).map(([policy, answer]) => {
		const stderrPath = join(directory, `${policy.slice(2)}.stderr`);
		writeFileSync(stderrPath, answer.stderr);
		return `*" ${policy} "*) cat '${stderrPath}' >&2; exit ${answer.exitCode} ;;`;
	});
	writeFileSync(
		npm,
		[
			"#!/bin/sh",
			`printf '%s\\n' "$*" >>'${callsPath}'`,
			'case " $* " in',
			...branches,
			"esac",
			"exit 64",
			"",
		].join("\n"),
		{ mode: 0o755 },
	);
	return {
		npm,
		calls: () =>
			existsSync(callsPath)
				? readFileSync(callsPath, "utf8").trim().split("\n")
				: [],
	};
}

describe("npm install metadata retry", () => {
	const succeeded = { stderr: "", exitCode: 0 };
	const etarget = { stderr: ETARGET_STDERR, exitCode: 1 };
	const offlineArguments = npmInstallCommand("npm", "--prefer-offline")
		.slice(1)
		.join(" ");
	const onlineArguments = npmInstallCommand("npm", "--prefer-online")
		.slice(1)
		.join(" ");

	async function withProject(
		run: (directory: string) => Promise<void>,
	): Promise<void> {
		const directory = mkdtempSync(join(tmpdir(), "listmonk-npm-retry-"));
		try {
			await run(directory);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}

	test("retries ETARGET from stale cached metadata", () => {
		expect(shouldRetryWithFreshMetadata(failedInstall(ETARGET_STDERR))).toBe(
			true,
		);
		// npm before 10 prefixed its errors with `npm ERR!`.
		expect(
			shouldRetryWithFreshMetadata(
				failedInstall(
					"npm ERR! code ETARGET\nnpm ERR! notarget No matching version found for zod@^4.9.0.\n",
				),
			),
		).toBe(true);
		// A forced color setting wraps the prefix and title in ANSI escapes.
		expect(
			shouldRetryWithFreshMetadata(
				failedInstall(
					"\u001b[31mnpm\u001b[39m \u001b[41merror\u001b[49m \u001b[35mnotarget\u001b[39m No matching version found for zod@^4.9.0.\n",
				),
			),
		).toBe(true);
	});

	test("reports every other outcome without a retry", () => {
		expect(
			shouldRetryWithFreshMetadata(
				failedInstall(ETARGET_STDERR, { exitCode: 0 }),
			),
		).toBe(false);
		for (const stderr of [
			"npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/notarget - Not found\n",
			"npm error code ENOTFOUND\nnpm error syscall getaddrinfo\n",
			"npm error code EINTEGRITY\n",
			"",
		]) {
			expect(shouldRetryWithFreshMetadata(failedInstall(stderr))).toBe(false);
		}
		// A stalled or killed install is not retried, which keeps the bound.
		expect(
			shouldRetryWithFreshMetadata(
				failedInstall(ETARGET_STDERR, {
					exitCode: 137,
					signal: "SIGKILL",
					timedOut: true,
				}),
			),
		).toBe(false);
		expect(
			shouldRetryWithFreshMetadata(
				failedInstall(ETARGET_STDERR, { signal: "SIGTERM" }),
			),
		).toBe(false);
	});

	test("installs with cached metadata first and retries ETARGET once with fresh metadata", async () => {
		await withProject(async (directory) => {
			const { npm, calls } = writeFakeNpm(directory, {
				"--prefer-offline": etarget,
				"--prefer-online": succeeded,
			});
			const reports: string[] = [];

			await npmInstall(npm, directory, (message) => reports.push(message));

			expect(calls()).toEqual([offlineArguments, onlineArguments]);
			expect(reports).toHaveLength(1);
			expect(reports[0]).toContain("ETARGET");
			expect(reports[0]).toContain("retrying once with --prefer-online");
		});
	});

	test("reports the retry's failure without a third attempt", async () => {
		await withProject(async (directory) => {
			const { npm, calls } = writeFakeNpm(directory, {
				"--prefer-offline": etarget,
				"--prefer-online": {
					stderr: "npm error code ENOTFOUND\n",
					exitCode: 1,
				},
			});

			await expect(npmInstall(npm, directory, () => {})).rejects.toThrow(
				"npm install --prefer-online (retry after ETARGET) exited with 1\nnpm error code ENOTFOUND",
			);
			expect(calls()).toEqual([offlineArguments, onlineArguments]);
		});
	});

	test("fails other install errors without a retry", async () => {
		await withProject(async (directory) => {
			const { npm, calls } = writeFakeNpm(directory, {
				"--prefer-offline": { stderr: "npm error code E404\n", exitCode: 1 },
				"--prefer-online": succeeded,
			});
			const reports: string[] = [];

			await expect(
				npmInstall(npm, directory, (message) => reports.push(message)),
			).rejects.toThrow("npm install exited with 1\nnpm error code E404");
			expect(calls()).toEqual([offlineArguments]);
			expect(reports).toEqual([]);
		});
	});
});
