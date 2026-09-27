/**
 * Type-checks the npm-published declarations of the `@listmonk-ops/*` packages
 * the way TypeScript consumers compile them.
 *
 * The check packs every workspace that ships declarations, plus the workspaces
 * they depend on, from the current build exactly like the release workflow
 * (`bun pm pack --ignore-scripts`). For each compiler in
 * `TYPESCRIPT_TOOLCHAINS` it installs the tarballs into a throwaway npm project
 * and compiles a consumer that imports every public entry point and subpath
 * export with `skipLibCheck: false` under the `bundler`, `node16`, and
 * `nodenext` module resolution modes.
 *
 * Third-party dependencies and the compilers come from the configured npm
 * registry (or the local npm cache). The check is skipped when npm or Node.js
 * is not installed.
 */
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	collectWorkspaceClosure,
	commandFailure,
	npmInstall,
	packWorkspace,
	REPOSITORY_ROOT,
	readWorkspaces,
	requireWorkspace,
	runCommand,
	type Workspace,
	type WorkspaceManifest,
} from "./check-cli-npm-install";

export interface TypeScriptToolchain {
	/** The `typescript` version installed into the consumer project. */
	typescript: string;
	/** An `@types/node` release that supports that compiler. */
	typesNode: string;
	/** Packages whose declarations need a newer compiler, and why. */
	unsupported?: { packages: readonly string[]; reason: string };
}

export interface ResolutionMode {
	name: string;
	module: string;
	moduleResolution: string;
}

export const RESOLUTION_MODES: readonly ResolutionMode[] = [
	{ name: "bundler", module: "esnext", moduleResolution: "bundler" },
	{ name: "node16", module: "node16", moduleResolution: "node16" },
	{ name: "nodenext", module: "nodenext", moduleResolution: "nodenext" },
];

function rootDevDependency(name: string): string {
	const manifest = JSON.parse(
		readFileSync(join(REPOSITORY_ROOT, "package.json"), "utf8"),
	) as { devDependencies?: Record<string, string> };
	const version = manifest.devDependencies?.[name];
	if (version === undefined) {
		throw new Error(`The root package.json does not declare ${name}`);
	}
	return version;
}

/**
 * The compilers consumers may use. Older compilers pair with the newest
 * `@types/node` that still supports them (DefinitelyTyped's `ts5.0` and `ts5.4`
 * dist-tags) because `skipLibCheck: false` also checks those typings. The last
 * entry is the repository's own TypeScript 7 toolchain.
 */
export const TYPESCRIPT_TOOLCHAINS: readonly TypeScriptToolchain[] = [
	{
		typescript: "5.0.4",
		typesNode: "22.13.14",
		unsupported: {
			// Their declarations expose zod 4 schemas, and zod's own declarations
			// use the `NoInfer` intrinsic that TypeScript 5.4 introduced.
			packages: [
				"@listmonk-ops/abtest",
				"@listmonk-ops/automation",
				"@listmonk-ops/operations",
			],
			reason: "their zod 4 types need TypeScript 5.4 (NoInfer)",
		},
	},
	{ typescript: "5.4.5", typesNode: "25.9.3" },
	{ typescript: "5.9.3", typesNode: "26.6.2" },
	{
		typescript: rootDevDependency("typescript"),
		typesNode: rootDevDependency("@types/node"),
	},
];

// Each spawned command is already bounded by the npm install check's command
// timeout. This budget is checked between commands, so a slow registry can hold
// a runner for at most the budget plus one command timeout.
const CHECK_BUDGET_MS = 10 * 60_000;

function log(message: string): void {
	console.log(`[package-types] ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Export conditions whose targets are the runtime files that the "types"
// condition describes and that the build must produce.
const RUNTIME_CONDITIONS = ["import", "default"] as const;

/** The declaration file TypeScript pairs with a JavaScript file. */
export function declarationPathFor(javascriptPath: string): string | undefined {
	const match = /\.([cm]?)js$/.exec(javascriptPath);
	if (!match) {
		return undefined;
	}
	return `${javascriptPath.slice(0, match.index)}.d.${match[1] ?? ""}ts`;
}

function subpathSpecifier(packageName: string, subpath: string): string {
	return subpath === "." ? packageName : `${packageName}${subpath.slice(1)}`;
}

/** Whether an exports target only names JSON files, such as package.json. */
function isJsonTarget(target: unknown): boolean {
	if (typeof target === "string") {
		return target.endsWith(".json");
	}
	const values = isRecord(target) ? Object.values(target) : [];
	return (
		values.length > 0 &&
		values.every((value) => typeof value === "string" && value.endsWith(".json"))
	);
}

/**
 * Problems that keep TypeScript from resolving a published entry point's
 * declarations in every module resolution mode.
 */
export function exportsMapProblems(manifest: WorkspaceManifest): string[] {
	const { exports } = manifest;
	if (exports === undefined) {
		return [];
	}
	if (!isRecord(exports)) {
		return [`${manifest.name}: "exports" must map subpaths to conditions`];
	}
	const problems: string[] = [];
	for (const [subpath, target] of Object.entries(exports)) {
		const label = `${manifest.name} exports["${subpath}"]`;
		if (target === null || isJsonTarget(target)) {
			// A hidden subpath or a JSON file such as package.json has no types.
			continue;
		}
		if (!subpath.startsWith(".") || subpath.includes("*")) {
			problems.push(`${label}: expected an explicit subpath such as "./sdk"`);
			continue;
		}
		if (!isRecord(target)) {
			problems.push(`${label}: expected conditions with "types" first`);
			continue;
		}
		const conditions = Object.keys(target);
		if (conditions[0] !== "types") {
			// Conditions match in object order, so a later "types" is never read
			// once "import" or "default" matches.
			problems.push(
				`${label}: list "types" first (found ${conditions.join(", ") || "none"})`,
			);
		}
		const types = target.types;
		if (typeof types !== "string" || !/\.d\.[cm]?ts$/.test(types)) {
			problems.push(`${label}: "types" must name a declaration file`);
			continue;
		}
		for (const condition of RUNTIME_CONDITIONS) {
			const runtime = target[condition];
			if (typeof runtime === "string" && declarationPathFor(runtime) !== types) {
				problems.push(
					`${label}: "types" ${types} does not describe "${condition}" ${runtime}`,
				);
			}
		}
		if (subpath === "." && manifest.types !== undefined && manifest.types !== types) {
			problems.push(
				`${manifest.name}: top-level "types" ${manifest.types} differs from exports["."] ${types}`,
			);
		}
	}
	return problems;
}

/** Import specifiers of every public entry point that ships declarations. */
export function publicEntryPoints(manifest: WorkspaceManifest): string[] {
	const { exports } = manifest;
	if (exports === undefined) {
		return manifest.types === undefined ? [] : [manifest.name];
	}
	if (!isRecord(exports)) {
		return [];
	}
	return Object.entries(exports)
		.filter(
			([subpath, target]) =>
				subpath.startsWith(".") &&
				!subpath.includes("*") &&
				isRecord(target) &&
				typeof target.types === "string",
		)
		.map(([subpath]) => subpathSpecifier(manifest.name, subpath));
}

/** Whether a manifest publishes at least one entry point with declarations. */
export function publishesDeclarations(manifest: WorkspaceManifest): boolean {
	return !manifest.private && publicEntryPoints(manifest).length > 0;
}

/** The entry points a compiler checks: those of every package it supports. */
export function toolchainEntryPoints(
	toolchain: TypeScriptToolchain,
	manifests: readonly WorkspaceManifest[],
): string[] {
	const unsupported = new Set(toolchain.unsupported?.packages ?? []);
	return manifests
		.filter((manifest) => !unsupported.has(manifest.name))
		.flatMap((manifest) => publicEntryPoints(manifest));
}

/** Unsupported package names that match no package with declarations. */
export function unknownUnsupportedPackages(
	toolchains: readonly TypeScriptToolchain[],
	manifests: readonly WorkspaceManifest[],
): string[] {
	const names = new Set(manifests.map((manifest) => manifest.name));
	return toolchains
		.flatMap((toolchain) => toolchain.unsupported?.packages ?? [])
		.filter((name) => !names.has(name));
}

/**
 * Problems in the exports maps of every published manifest, including those
 * whose exports name no declarations at all, and in `toolchains`.
 */
export function publishedDeclarationProblems(
	manifests: readonly WorkspaceManifest[],
	toolchains: readonly TypeScriptToolchain[] = TYPESCRIPT_TOOLCHAINS,
): string[] {
	const published = manifests.filter((manifest) => !manifest.private);
	const withDeclarations = manifests.filter(publishesDeclarations);
	return [
		...published.flatMap((manifest) => exportsMapProblems(manifest)),
		...unknownUnsupportedPackages(toolchains, withDeclarations).map(
			(name) => `TYPESCRIPT_TOOLCHAINS: ${name} ships no declarations`,
		),
	];
}

/** Declaration files that the public entry points of a manifest name. */
function publicDeclarationFiles(manifest: WorkspaceManifest): string[] {
	if (!isRecord(manifest.exports)) {
		return manifest.types === undefined ? [] : [manifest.types];
	}
	return Object.values(manifest.exports).flatMap((target) =>
		isRecord(target) && typeof target.types === "string" ? [target.types] : [],
	);
}

/** Runtime files that `main` and the export conditions of a manifest name. */
export function publicRuntimeFiles(manifest: WorkspaceManifest): string[] {
	const files = new Set(manifest.main === undefined ? [] : [manifest.main]);
	if (isRecord(manifest.exports)) {
		for (const target of Object.values(manifest.exports)) {
			for (const condition of RUNTIME_CONDITIONS) {
				const runtime = isRecord(target) ? target[condition] : undefined;
				if (typeof runtime === "string" && !runtime.endsWith(".json")) {
					files.add(runtime);
				}
			}
		}
	}
	return [...files];
}

/** A consumer module that imports every public entry point. */
export function renderConsumerSource(entryPoints: readonly string[]): string {
	return [
		"// Generated by scripts/check-package-types.ts.",
		...entryPoints.map(
			(specifier, index) =>
				`import * as entry${index} from ${JSON.stringify(specifier)};`,
		),
		"",
		`export const entryPoints = [${entryPoints
			.map((_, index) => `entry${index}`)
			.join(", ")}] as const;`,
		"",
	].join("\n");
}

/** The consumer compiler options for one module resolution mode. */
export function renderConsumerTsconfig(mode: ResolutionMode): string {
	const config = {
		compilerOptions: {
			target: "ES2022",
			lib: ["ES2022", "DOM"],
			module: mode.module,
			moduleResolution: mode.moduleResolution,
			types: ["node"],
			strict: true,
			noEmit: true,
			// Consumers that check library declarations must see no errors either.
			skipLibCheck: false,
		},
		files: ["consumer.ts"],
	};
	return `${JSON.stringify(config, null, 2)}\n`;
}

/** Compiler error lines (`file(line,column): error TS1234: message`). */
export function typeScriptErrors(output: string): string[] {
	return output
		.split("\n")
		.map((line) => line.trimEnd())
		.filter((line) => /\berror TS\d+:/.test(line));
}

export interface MatrixCell {
	typescript: string;
	mode: string;
	errors: string[];
	/** Set when the compiler failed without reporting diagnostics. */
	failure?: string;
}

function cellPassed(cell: MatrixCell): boolean {
	return cell.errors.length === 0 && cell.failure === undefined;
}

function assertBuilt(packed: readonly Workspace[]): void {
	for (const { directory, manifest } of packed) {
		const outputs = [
			...publicRuntimeFiles(manifest),
			...publicDeclarationFiles(manifest),
		];
		for (const output of outputs) {
			if (!existsSync(resolve(directory, output))) {
				throw new Error(
					`${manifest.name} has no build output at ${output}; run bun run build first`,
				);
			}
		}
	}
}

function assertWithinBudget(startedAt: number): void {
	if (performance.now() - startedAt > CHECK_BUDGET_MS) {
		throw new Error(
			`The declaration check exceeded its ${CHECK_BUDGET_MS / 60_000} minute budget; a stalled npm registry is the likely cause`,
		);
	}
}

function writeConsumerProject(
	projectDirectory: string,
	packedDependencies: Record<string, string>,
	toolchain: TypeScriptToolchain,
	entryPoints: readonly string[],
): void {
	mkdirSync(projectDirectory);
	const manifest = {
		name: "listmonk-ops-package-types-check",
		version: "0.0.0",
		private: true,
		type: "module",
		// Every packed workspace is a direct dependency so npm satisfies internal
		// semver ranges with these tarballs instead of published registry copies.
		dependencies: {
			...packedDependencies,
			"@types/node": toolchain.typesNode,
			typescript: toolchain.typescript,
		},
	};
	writeFileSync(
		join(projectDirectory, "package.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	writeFileSync(
		join(projectDirectory, "consumer.ts"),
		renderConsumerSource(entryPoints),
	);
	for (const mode of RESOLUTION_MODES) {
		writeFileSync(
			join(projectDirectory, `tsconfig.${mode.name}.json`),
			renderConsumerTsconfig(mode),
		);
	}
}

function installedVersion(projectDirectory: string, name: string): string {
	const manifest = JSON.parse(
		readFileSync(
			join(projectDirectory, "node_modules", name, "package.json"),
			"utf8",
		),
	) as { version: string };
	return manifest.version;
}

async function compileConsumer(
	node: string,
	projectDirectory: string,
	typescript: string,
	mode: ResolutionMode,
): Promise<MatrixCell> {
	const result = await runCommand(
		[
			node,
			join(projectDirectory, "node_modules", "typescript", "bin", "tsc"),
			"--project",
			`tsconfig.${mode.name}.json`,
			"--pretty",
			"false",
		],
		{ cwd: projectDirectory, env: process.env },
	);
	const cell: MatrixCell = {
		typescript,
		mode: mode.name,
		errors: typeScriptErrors(`${result.stdout}\n${result.stderr}`),
	};
	if (result.exitCode !== 0 && cell.errors.length === 0) {
		cell.failure = commandFailure(
			`tsc ${typescript} (${mode.name})`,
			result,
		).message;
	}
	return cell;
}

/** A plain-text table of pass/fail results by compiler and resolution mode. */
export function formatMatrix(
	cells: readonly MatrixCell[],
	modes: readonly string[],
): string[] {
	const compilers = [...new Set(cells.map((cell) => cell.typescript))];
	const status = (typescript: string, mode: string): string => {
		const cell = cells.find(
			(candidate) =>
				candidate.typescript === typescript && candidate.mode === mode,
		);
		if (cell === undefined) {
			return "-";
		}
		if (cellPassed(cell)) {
			return "pass";
		}
		return cell.errors.length > 0 ? `FAIL (${cell.errors.length})` : "FAIL";
	};
	const rows = [
		["TypeScript", ...modes],
		...compilers.map((typescript) => [
			typescript,
			...modes.map((mode) => status(typescript, mode)),
		]),
	];
	const widths = rows[0]?.map((_, column) =>
		Math.max(...rows.map((row) => (row[column] ?? "").length)),
	);
	return rows.map((row) =>
		row
			.map((value, column) => value.padEnd(widths?.[column] ?? 0))
			.join("  ")
			.trimEnd(),
	);
}

function describeFailures(cells: readonly MatrixCell[]): string {
	const excerptLength = 8;
	return cells
		.filter((cell) => !cellPassed(cell))
		.map((cell) => {
			const heading = `TypeScript ${cell.typescript} (${cell.mode})`;
			if (cell.failure !== undefined) {
				return `${heading}:\n${cell.failure}`;
			}
			const excerpt = cell.errors.slice(0, excerptLength);
			const omitted = cell.errors.length - excerpt.length;
			return [
				`${heading}: ${cell.errors.length} error(s)`,
				...excerpt.map((line) => `  ${line}`),
				...(omitted > 0 ? [`  ... ${omitted} more`] : []),
			].join("\n");
		})
		.join("\n");
}

export async function checkPackageTypes(
	options: { keep?: boolean } = {},
): Promise<void> {
	const npm = Bun.which("npm");
	const node = Bun.which("node");
	if (!npm || !node) {
		log(
			"npm or Node.js is not installed; skipping the published declaration check.",
		);
		return;
	}
	const startedAt = performance.now();
	const workspaces = readWorkspaces();
	const manifests = [...workspaces.values()].map(({ manifest }) => manifest);
	const declarationPackages = manifests.filter(publishesDeclarations);
	const problems = publishedDeclarationProblems(manifests);
	if (problems.length > 0) {
		throw new Error(
			`Published declarations cannot be resolved:\n${problems.join("\n")}`,
		);
	}
	const packed = [
		...new Set(
			declarationPackages.flatMap((manifest) =>
				collectWorkspaceClosure(manifest.name, workspaces),
			),
		),
	]
		.sort()
		.map((name) => requireWorkspace(workspaces, name));
	assertBuilt(packed);

	const workDirectory = mkdtempSync(join(tmpdir(), "listmonk-package-types-"));
	try {
		const packDirectory = join(workDirectory, "packs");
		mkdirSync(packDirectory);
		const packedDependencies: Record<string, string> = {};
		for (const workspace of packed) {
			packedDependencies[workspace.manifest.name] =
				`file:${await packWorkspace(workspace, packDirectory)}`;
		}
		log(`packed ${Object.keys(packedDependencies).join(", ")}`);
		log(
			`entry points: ${declarationPackages.flatMap((manifest) => publicEntryPoints(manifest)).join(", ")}`,
		);

		const cells: MatrixCell[] = [];
		const notes: string[] = [];
		for (const [index, toolchain] of TYPESCRIPT_TOOLCHAINS.entries()) {
			assertWithinBudget(startedAt);
			const projectDirectory = join(workDirectory, `consumer-${index}`);
			writeConsumerProject(
				projectDirectory,
				packedDependencies,
				toolchain,
				toolchainEntryPoints(toolchain, declarationPackages),
			);
			await npmInstall(npm, projectDirectory);
			const typescript = installedVersion(projectDirectory, "typescript");
			const label = toolchain.unsupported ? `${typescript}*` : typescript;
			for (const mode of RESOLUTION_MODES) {
				assertWithinBudget(startedAt);
				cells.push(await compileConsumer(node, projectDirectory, label, mode));
			}
			log(
				`TypeScript ${typescript} with @types/node ${installedVersion(projectDirectory, "@types/node")} compiled the consumer`,
			);
			if (toolchain.unsupported) {
				notes.push(
					`* skips ${toolchain.unsupported.packages.join(", ")}: ${toolchain.unsupported.reason}`,
				);
			}
			if (!options.keep) {
				// One project at a time keeps the check's disk footprint small.
				rmSync(projectDirectory, { recursive: true, force: true });
			}
		}

		for (const line of [
			...formatMatrix(
				cells,
				RESOLUTION_MODES.map((mode) => mode.name),
			),
			...notes,
		]) {
			log(line);
		}
		if (!cells.every(cellPassed)) {
			throw new Error(
				`Published declarations fail to type-check for consumers:\n${describeFailures(cells)}`,
			);
		}
		log(
			"every public entry point type-checks with skipLibCheck: false in every supported compiler and resolution mode",
		);
	} finally {
		if (options.keep) {
			log(`kept ${workDirectory}`);
		} else {
			rmSync(workDirectory, { recursive: true, force: true });
		}
	}
}

if (import.meta.main) {
	await checkPackageTypes({ keep: process.argv.includes("--keep") });
}
