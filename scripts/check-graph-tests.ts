import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");
const testPatterns = ["apps/*/tests/**/*.ts", "packages/*/tests/**/*.ts"];

const compiler = Bun.spawn({
	cmd: [
		process.execPath,
		"x",
		"tsc",
		"--listFiles",
		"--noCheck",
		"-p",
		"tsconfig.graph.json",
	],
	cwd: projectRoot,
	stderr: "pipe",
	stdout: "pipe",
});
const [compilerOutput, compilerError, compilerExitCode] = await Promise.all([
	new Response(compiler.stdout).text(),
	new Response(compiler.stderr).text(),
	compiler.exited,
]);

if (compilerExitCode !== 0) {
	throw new Error(
		compilerError || "Failed to read the graph TypeScript program.",
	);
}

const graphFiles = new Set(
	compilerOutput
		.split(/\r?\n/)
		.filter(Boolean)
		.map((fileName) => resolve(fileName)),
);
const testFiles = new Set<string>();

for (const pattern of testPatterns) {
	for await (const fileName of new Bun.Glob(pattern).scan({
		absolute: true,
		cwd: projectRoot,
		followSymlinks: false,
		onlyFiles: true,
	})) {
		testFiles.add(resolve(fileName));
	}
}

const missingTests = [...testFiles]
	.filter((fileName) => !graphFiles.has(fileName))
	.sort();

if (missingTests.length > 0) {
	const relativePaths = missingTests.map((fileName) =>
		fileName.slice(projectRoot.length + 1),
	);
	throw new Error(
		`tsconfig.graph.json excludes TypeScript test files:\n${relativePaths.join("\n")}`,
	);
}

console.log(
	`Graph includes all ${testFiles.size} TypeScript test/support files.`,
);
