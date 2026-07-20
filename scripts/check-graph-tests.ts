import { resolve } from "node:path";
import { $ } from "bun";

const projectRoot = resolve(import.meta.dir, "..");
const mainGraphConfig = "tsconfig.graph.json";
const openapiGraphConfig = "tsconfig.graph.openapi.json";
const testPatterns = [
	"apps/*/tests/**/*.ts",
	"packages/*/tests/**/*.ts",
	"scripts/**/*.test.ts",
];
const generatedOpenapiPattern = "packages/openapi/generated/**/*.ts";
const openapiGraphAnchors = [
	"packages/openapi/src/client/factory.ts",
	"packages/openapi/src/client/resource-operations.ts",
	"packages/openapi/src/client/service-operations.ts",
	"packages/openapi/tests/resource-operations.test.ts",
	"packages/openapi/tests/service-operations.test.ts",
];

async function readGraphRoots(tsconfig: string): Promise<Set<string>> {
	const { stdout, stderr, exitCode } =
		await $`bun x tsc --showConfig -p ${tsconfig}`
			.cwd(projectRoot)
			.quiet()
			.nothrow();

	if (exitCode !== 0) {
		throw new Error(
			stderr.toString() || `Failed to read TypeScript roots from ${tsconfig}.`,
		);
	}

	const configOutput = stdout.toString();
	let config: { files?: unknown };
	try {
		config = JSON.parse(configOutput) as { files?: unknown };
	} catch (error) {
		throw new Error(
			`Failed to parse tsc --showConfig output for ${tsconfig}: ${String(error)}\n${configOutput}`,
		);
	}

	// TypeScript 7 expands include/exclude into this root-only list. --listFiles
	// would also include imported dependencies and blur the generated-root contract.
	if (
		!Array.isArray(config.files) ||
		config.files.length === 0 ||
		!config.files.every((fileName) => typeof fileName === "string")
	) {
		throw new Error(
			`No resolved root files found in ${tsconfig} via tsc --showConfig.`,
		);
	}
	return new Set(
		config.files.map((fileName) => resolve(projectRoot, fileName)),
	);
}

async function scanFiles(patterns: string[]): Promise<Set<string>> {
	const files = new Set<string>();

	for (const pattern of patterns) {
		for await (const fileName of new Bun.Glob(pattern).scan({
			absolute: true,
			cwd: projectRoot,
			followSymlinks: false,
			onlyFiles: true,
		})) {
			files.add(resolve(fileName));
		}
	}

	return files;
}

function formatRelativePaths(fileNames: string[]): string {
	return fileNames
		.map((fileName) => fileName.slice(projectRoot.length + 1))
		.join("\n");
}

const [mainGraphRoots, openapiGraphRoots, testFiles, generatedOpenapiFiles] =
	await Promise.all([
		readGraphRoots(mainGraphConfig),
		readGraphRoots(openapiGraphConfig),
		scanFiles(testPatterns),
		scanFiles([generatedOpenapiPattern]),
	]);

if (testFiles.size === 0) {
	throw new Error(
		"No TypeScript test/support files matched the graph contract.",
	);
}

if (generatedOpenapiFiles.size === 0) {
	throw new Error(
		`No generated OpenAPI files matched ${generatedOpenapiPattern}.`,
	);
}

const missingTests = [...testFiles]
	.filter((fileName) => !mainGraphRoots.has(fileName))
	.sort();

if (missingTests.length > 0) {
	throw new Error(
		`${mainGraphConfig} excludes TypeScript test files:\n${formatRelativePaths(missingTests)}`,
	);
}

const generatedMainRoots = [...generatedOpenapiFiles]
	.filter((fileName) => mainGraphRoots.has(fileName))
	.sort();

if (generatedMainRoots.length > 0) {
	throw new Error(
		`${mainGraphConfig} includes generated OpenAPI files as roots:\n${formatRelativePaths(generatedMainRoots)}`,
	);
}

const missingGeneratedOpenapiRoots = [...generatedOpenapiFiles]
	.filter((fileName) => !openapiGraphRoots.has(fileName))
	.sort();

if (missingGeneratedOpenapiRoots.length > 0) {
	throw new Error(
		`${openapiGraphConfig} excludes generated SDK roots:\n${formatRelativePaths(missingGeneratedOpenapiRoots)}`,
	);
}

const missingOpenapiAnchors = openapiGraphAnchors
	.map((fileName) => resolve(projectRoot, fileName))
	.filter((fileName) => !openapiGraphRoots.has(fileName))
	.sort();

if (missingOpenapiAnchors.length > 0) {
	throw new Error(
		`${openapiGraphConfig} excludes OpenAPI graph anchors:\n${formatRelativePaths(missingOpenapiAnchors)}`,
	);
}

console.log(
	`Main graph roots include all ${testFiles.size} TypeScript test/support files and no generated OpenAPI roots.`,
);
console.log(
	`OpenAPI debug graph roots include ${generatedOpenapiFiles.size} generated SDK files and ${openapiGraphAnchors.length} named anchors.`,
);
