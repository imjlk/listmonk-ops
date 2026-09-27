/**
 * Verifies the npm-published shape of `@listmonk-ops/cli`.
 *
 * The release workflow packs each workspace with `bun pm pack --ignore-scripts`
 * and publishes the tarballs with npm. This check packs the CLI and every
 * `@listmonk-ops/*` workspace it depends on from the current build the same
 * way, installs the tarballs into a throwaway npm project, and runs the
 * installed `listmonk-cli` bin without contacting Listmonk.
 *
 * Third-party dependencies still come from the configured npm registry (or the
 * local npm cache). The check is skipped when npm is not installed.
 */
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

export const REPOSITORY_ROOT = resolve(import.meta.dir, "..");
export const WORKSPACE_SCOPE = "@listmonk-ops/";
export const CLI_PACKAGE_NAME = "@listmonk-ops/cli";

type DependencyMap = Record<string, string>;

export interface WorkspaceManifest {
	name: string;
	version: string;
	private?: boolean;
	main?: string;
	types?: string;
	exports?: unknown;
	scripts?: Record<string, string>;
	dependencies?: DependencyMap;
	optionalDependencies?: DependencyMap;
	peerDependencies?: DependencyMap;
}

export interface Workspace {
	directory: string;
	manifest: WorkspaceManifest;
}

/** Reads the `apps/*` and `packages/*` workspace manifests keyed by name. */
export function readWorkspaces(
	root: string = REPOSITORY_ROOT,
): Map<string, Workspace> {
	const workspaces = new Map<string, Workspace>();
	for (const group of ["apps", "packages"]) {
		const groupDirectory = join(root, group);
		if (!existsSync(groupDirectory)) {
			continue;
		}
		for (const entry of readdirSync(groupDirectory, { withFileTypes: true })) {
			const manifestPath = join(groupDirectory, entry.name, "package.json");
			if (!entry.isDirectory() || !existsSync(manifestPath)) {
				continue;
			}
			const manifest = JSON.parse(
				readFileSync(manifestPath, "utf8"),
			) as WorkspaceManifest;
			workspaces.set(manifest.name, {
				directory: dirname(manifestPath),
				manifest,
			});
		}
	}
	return workspaces;
}

export function requireWorkspace(
	workspaces: ReadonlyMap<string, Workspace>,
	name: string,
): Workspace {
	const workspace = workspaces.get(name);
	if (!workspace) {
		throw new Error(`${name} is not a workspace package`);
	}
	return workspace;
}

/** Scoped workspace packages that a manifest requires at runtime. */
export function workspaceRuntimeDependencies(
	manifest: WorkspaceManifest,
): string[] {
	return Object.keys(manifest.dependencies ?? {})
		.filter((name) => name.startsWith(WORKSPACE_SCOPE))
		.sort();
}

/** The named workspace plus every workspace reachable through runtime dependencies. */
export function collectWorkspaceClosure(
	name: string,
	workspaces: ReadonlyMap<string, Workspace>,
): string[] {
	const closure = new Set<string>();
	const pending = [name];
	while (pending.length > 0) {
		const next = pending.pop();
		if (next === undefined || closure.has(next)) {
			continue;
		}
		closure.add(next);
		pending.push(
			...workspaceRuntimeDependencies(
				requireWorkspace(workspaces, next).manifest,
			),
		);
	}
	return [...closure].sort();
}

/** Whether a package script bundles publishable JavaScript (not a native binary). */
export function isPublishedBundleCommand(command: string): boolean {
	return (
		/(?:^|[\s&;|])(?:esbuild|bun build)\s/.test(command) &&
		!/\s--compile\b/.test(command)
	);
}

/** Packages marked external by a bun or esbuild command line. */
export function parseBundlerExternals(command: string): string[] {
	return [
		...command.matchAll(/--external(?:[=:]|\s+)(["']?)([^\s"']+)\1/g),
	].map((match) => match[2] ?? "");
}

/** Every installed copy of a scoped workspace package below a project, keyed by name. */
export async function findInstalledWorkspaceCopies(
	projectDirectory: string,
): Promise<Map<string, string[]>> {
	const copies = new Map<string, string[]>();
	const manifests = new Bun.Glob(
		"**/node_modules/@listmonk-ops/*/package.json",
	).scan({ cwd: projectDirectory, followSymlinks: false });
	for await (const manifestPath of manifests) {
		const packageDirectory = join(projectDirectory, dirname(manifestPath));
		const { name } = JSON.parse(
			readFileSync(join(projectDirectory, manifestPath), "utf8"),
		) as { name: string };
		copies.set(name, [...(copies.get(name) ?? []), packageDirectory].sort());
	}
	return copies;
}

export interface CommandResult {
	exitCode: number;
	signal: string | null;
	timedOut: boolean;
	stdout: string;
	stderr: string;
}

export type Environment = Record<string, string | undefined>;

const NPM_LIFECYCLE_VARIABLE =
	/^npm_(?:command|execpath|node_execpath|lifecycle_\w+|package_\w+|config_local_prefix|config_user_agent)$/i;

// A stalled registry fetch or CLI run must fail the check instead of holding
// a CI runner until the job-level timeout. SIGKILL cannot be trapped or
// ignored, so the bound holds even for a child that mishandles SIGTERM.
const COMMAND_TIMEOUT_MS = 5 * 60_000;
const COMMAND_TIMEOUT_SIGNAL = "SIGKILL";

function readOutput(path: string): string {
	return existsSync(path) ? readFileSync(path, "utf8") : "";
}

export async function runCommand(
	command: readonly string[],
	options: { cwd: string; env: Environment },
): Promise<CommandResult> {
	// Output goes to files rather than pipes: a descendant that outlives a
	// killed child could otherwise keep a pipe open and block its drain.
	const outputDirectory = mkdtempSync(
		join(tmpdir(), "listmonk-cli-npm-install-output-"),
	);
	const stdoutPath = join(outputDirectory, "stdout");
	const stderrPath = join(outputDirectory, "stderr");
	try {
		const startedAt = performance.now();
		const child = Bun.spawn([...command], {
			cwd: options.cwd,
			env: options.env,
			stdin: "ignore",
			stdout: Bun.file(stdoutPath),
			stderr: Bun.file(stderrPath),
			timeout: COMMAND_TIMEOUT_MS,
			killSignal: COMMAND_TIMEOUT_SIGNAL,
		});
		const exitCode = await child.exited;
		const elapsedMs = performance.now() - startedAt;
		const signal = child.signalCode;
		return {
			exitCode,
			signal,
			// An external SIGKILL (for example an OOM kill) is not a timeout.
			timedOut:
				signal === COMMAND_TIMEOUT_SIGNAL && elapsedMs >= COMMAND_TIMEOUT_MS,
			stdout: readOutput(stdoutPath),
			stderr: readOutput(stderrPath),
		};
	} finally {
		rmSync(outputDirectory, { recursive: true, force: true });
	}
}

function describeOutcome(result: CommandResult): string {
	if (result.timedOut) {
		return `timed out after ${COMMAND_TIMEOUT_MS / 1000}s`;
	}
	if (result.signal !== null) {
		return `was stopped by ${result.signal}`;
	}
	return `exited with ${result.exitCode}`;
}

export function commandFailure(label: string, result: CommandResult): Error {
	return new Error(
		`${label} ${describeOutcome(result)}\n${result.stdout}${result.stderr}`.trim(),
	);
}

function log(message: string): void {
	console.log(`[cli-npm-install] ${message}`);
}

/** Installs a throwaway project's dependencies with npm, as a consumer would. */
export async function npmInstall(
	npm: string,
	projectDirectory: string,
): Promise<void> {
	// `bun run` exports npm lifecycle variables, including a local prefix that
	// points at this repository; keep only the caller's own npm configuration.
	const npmEnvironment: Environment = Object.fromEntries(
		Object.entries(process.env).filter(
			([key]) => !NPM_LIFECYCLE_VARIABLE.test(key),
		),
	);
	const install = await runCommand(
		[
			npm,
			"install",
			"--no-audit",
			"--no-fund",
			"--prefer-offline",
			"--ignore-scripts",
			"--loglevel=error",
		],
		{ cwd: projectDirectory, env: npmEnvironment },
	);
	if (install.exitCode !== 0) {
		throw commandFailure("npm install", install);
	}
}

/** Packs one workspace exactly like the release workflow and returns the tarball path. */
export async function packWorkspace(
	workspace: Workspace,
	destination: string,
): Promise<string> {
	const result = await runCommand(
		[
			process.execPath,
			"pm",
			"pack",
			"--destination",
			destination,
			"--ignore-scripts",
			"--quiet",
		],
		{ cwd: workspace.directory, env: process.env },
	);
	const reported = result.stdout.trim().split("\n").at(-1)?.trim() ?? "";
	if (result.exitCode !== 0 || reported.length === 0) {
		throw commandFailure(`bun pm pack (${workspace.manifest.name})`, result);
	}
	const tarball = resolve(destination, reported);
	if (!existsSync(tarball)) {
		throw new Error(
			`Packed tarball for ${workspace.manifest.name} not found: ${reported}`,
		);
	}
	return tarball;
}

// Preloaded into the installed CLI. It observes every `instanceof` check
// against the OperationExecutionError class exported by the installed
// @listmonk-ops/operations package. When the CLI bundle inlined a private copy
// of that package, the CLI's own checks never reach this class.
const INSTANCEOF_PROBE_SOURCE = `import { writeFileSync } from "node:fs";
import { OperationExecutionError } from "@listmonk-ops/operations";

const observations = [];
const hasInstance = Function.prototype[Symbol.hasInstance];
Object.defineProperty(OperationExecutionError, Symbol.hasInstance, {
	configurable: true,
	value(candidate) {
		const result = hasInstance.call(this, candidate);
		observations.push({
			candidate: candidate instanceof Error ? candidate.name : typeof candidate,
			result,
		});
		return result;
	},
});
process.on("exit", () => {
	writeFileSync(
		process.env.LISTMONK_OPS_INSTANCEOF_PROBE_OUTPUT,
		JSON.stringify(observations),
	);
});
`;

interface InstanceofObservation {
	candidate: string;
	result: boolean;
}

/** Parses the last JSON object line a CLI run printed in `--format json`. */
function parseStructuredError(
	stderr: string,
): { code?: unknown; message?: unknown } | undefined {
	for (const line of stderr.trim().split("\n").reverse()) {
		try {
			const document = JSON.parse(line) as { error?: unknown };
			if (typeof document.error === "object" && document.error !== null) {
				return document.error as { code?: unknown; message?: unknown };
			}
		} catch {
			// Diagnostics and other non-JSON lines are ignored.
		}
	}
	return undefined;
}

async function assertInstalledTree(
	projectDirectory: string,
	packed: readonly Workspace[],
): Promise<void> {
	const copies = await findInstalledWorkspaceCopies(projectDirectory);
	const packedNames = new Set(packed.map(({ manifest }) => manifest.name));
	const unexpected = [...copies.keys()].filter(
		(name) => !packedNames.has(name),
	);
	if (unexpected.length > 0) {
		throw new Error(
			`npm installed @listmonk-ops packages that were not packed from this checkout: ${unexpected.join(", ")}`,
		);
	}
	for (const { manifest } of packed) {
		const expected = join(projectDirectory, "node_modules", manifest.name);
		const locations = copies.get(manifest.name) ?? [];
		if (locations.length !== 1 || locations[0] !== expected) {
			throw new Error(
				`Expected exactly one hoisted copy of ${manifest.name}, found: ${locations.join(", ") || "none"}`,
			);
		}
		const installed = JSON.parse(
			readFileSync(join(expected, "package.json"), "utf8"),
		) as { version: string };
		if (installed.version !== manifest.version) {
			throw new Error(
				`Installed ${manifest.name}@${installed.version} instead of the packed ${manifest.version}`,
			);
		}
	}
	for (const entry of ["node_modules/typescript", "node_modules/.bin/tsc"]) {
		if (existsSync(join(projectDirectory, entry))) {
			throw new Error(
				`Installing the CLI pulled in a TypeScript compiler (${entry}); runtime packages must not depend on or peer on typescript`,
			);
		}
	}
}

async function assertCliVersion(
	bin: string,
	projectDirectory: string,
	env: Environment,
	version: string,
): Promise<void> {
	const result = await runCommand([bin, "--version"], {
		cwd: projectDirectory,
		env,
	});
	if (result.exitCode !== 0 || result.stdout.trim() !== version) {
		throw commandFailure(
			`listmonk-cli --version (expected ${version})`,
			result,
		);
	}
}

/**
 * A truncated outbox makes `webhooks dispatch` fail inside
 * @listmonk-ops/automation, which wraps the failure in its
 * OperationExecutionError. The CLI then checks that error with `instanceof`
 * before rendering the structured JSON error.
 */
async function assertSharedOperationErrors(
	bin: string,
	projectDirectory: string,
	env: Environment,
	workDirectory: string,
): Promise<void> {
	const outboxPath = env.LISTMONK_OPS_WEBHOOK_STORE;
	if (!outboxPath) {
		throw new Error("The CLI environment must pin the webhook store path");
	}
	writeFileSync(outboxPath, '{"schemaVersion":');
	const probePath = join(projectDirectory, "instanceof-probe.mjs");
	const observationsPath = join(workDirectory, "instanceof-probe.json");
	writeFileSync(probePath, INSTANCEOF_PROBE_SOURCE);

	const result = await runCommand(
		[
			process.execPath,
			"--preload",
			probePath,
			bin,
			"webhooks",
			"dispatch",
			"--confirm",
			"--format",
			"json",
		],
		{
			cwd: projectDirectory,
			env: { ...env, LISTMONK_OPS_INSTANCEOF_PROBE_OUTPUT: observationsPath },
		},
	);
	const error = parseStructuredError(result.stderr);
	if (
		result.exitCode !== 1 ||
		error?.code !== "cli_error" ||
		typeof error.message !== "string" ||
		!/JSON/i.test(error.message)
	) {
		throw commandFailure(
			"listmonk-cli webhooks dispatch against a truncated outbox",
			result,
		);
	}
	if (!existsSync(observationsPath)) {
		throw commandFailure(
			"the instanceof probe did not record a result",
			result,
		);
	}
	const observations = JSON.parse(
		readFileSync(observationsPath, "utf8"),
	) as InstanceofObservation[];
	const recognized = observations.some(
		(observation) =>
			observation.candidate === "OperationExecutionError" &&
			observation.result,
	);
	if (!recognized) {
		throw new Error(
			[
				"The installed CLI never recognized the OperationExecutionError thrown by @listmonk-ops/automation",
				"as an instance of the class exported by @listmonk-ops/operations.",
				"The CLI JS bundle probably inlines a private copy of a workspace package;",
				`keep every ${WORKSPACE_SCOPE}* dependency external in apps/cli build:js.`,
				`Observed checks: ${JSON.stringify(observations)}`,
			].join(" "),
		);
	}
}

export async function checkCliNpmInstall(
	options: { keep?: boolean } = {},
): Promise<void> {
	const npm = Bun.which("npm");
	if (!npm) {
		log("npm is not installed; skipping the published-shape install check.");
		return;
	}
	const workspaces = readWorkspaces();
	const cli = requireWorkspace(workspaces, CLI_PACKAGE_NAME);
	const packed = collectWorkspaceClosure(CLI_PACKAGE_NAME, workspaces).map(
		(name) => requireWorkspace(workspaces, name),
	);
	for (const { directory, manifest } of packed) {
		if (!manifest.main || !existsSync(resolve(directory, manifest.main))) {
			throw new Error(
				`${manifest.name} has no build output at ${manifest.main ?? "its main entry"}; run bun run build first`,
			);
		}
	}

	const workDirectory = mkdtempSync(
		join(tmpdir(), "listmonk-cli-npm-install-"),
	);
	try {
		const packDirectory = join(workDirectory, "packs");
		const projectDirectory = join(workDirectory, "project");
		const homeDirectory = join(workDirectory, "home");
		const stateDirectory = join(workDirectory, "state");
		for (const directory of [
			packDirectory,
			projectDirectory,
			homeDirectory,
			stateDirectory,
		]) {
			mkdirSync(directory);
		}

		const dependencies: DependencyMap = {};
		for (const workspace of packed) {
			dependencies[workspace.manifest.name] =
				`file:${await packWorkspace(workspace, packDirectory)}`;
		}
		log(`packed ${Object.keys(dependencies).join(", ")}`);

		// Every packed workspace is a direct dependency so npm satisfies the CLI's
		// semver ranges with these tarballs instead of published registry copies.
		writeFileSync(
			join(projectDirectory, "package.json"),
			`${JSON.stringify(
				{
					name: "listmonk-cli-npm-install-check",
					version: "0.0.0",
					private: true,
					dependencies,
				},
				null,
				2,
			)}\n`,
		);
		await npmInstall(npm, projectDirectory);
		log("installed the packed tarballs with npm");

		await assertInstalledTree(projectDirectory, packed);
		log("one copy of each @listmonk-ops package and no TypeScript compiler");

		// Offline, isolated runtime: no inherited Listmonk configuration or state.
		const cliEnvironment: Environment = {
			PATH: [dirname(process.execPath), process.env.PATH ?? ""].join(delimiter),
			HOME: homeDirectory,
			TMPDIR: process.env.TMPDIR,
			NO_COLOR: "1",
			BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
			LISTMONK_OPS_DATA_DIR: stateDirectory,
			LISTMONK_OPS_AUDIT_STORE: join(stateDirectory, "operation-audit.json"),
			LISTMONK_OPS_WEBHOOK_STORE: join(stateDirectory, "outbound-webhooks.json"),
			LISTMONK_OPS_SEQUENCE_STORE: join(stateDirectory, "sequences.json"),
		};
		const bin = join(projectDirectory, "node_modules", ".bin", "listmonk-cli");
		await assertCliVersion(
			bin,
			projectDirectory,
			cliEnvironment,
			cli.manifest.version,
		);
		log(`listmonk-cli --version printed ${cli.manifest.version}`);

		await assertSharedOperationErrors(
			bin,
			projectDirectory,
			cliEnvironment,
			workDirectory,
		);
		log(
			"the CLI recognized an automation OperationExecutionError through the shared operations class",
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
	await checkCliNpmInstall({ keep: process.argv.includes("--keep") });
}
