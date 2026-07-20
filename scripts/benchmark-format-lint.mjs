import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const format = (ms) => `${ms.toFixed(2)}ms`;

const tasks = [
	{
		name: "Biome format",
		command: "bun run format:biome",
		category: "format",
	},
	{
		name: "Biome lint",
		command: "bun run lint:biome",
		category: "lint",
	},
	{
		name: "ttsc format",
		command: "bun run format:ttsc",
		category: "format",
	},
	{
		name: "ttsc lint",
		command: "bun run lint:ttsc",
		category: "lint",
	},
];

const run = (command) => {
	const start = performance.now();
	const result = spawnSync(command, {
		shell: true,
		stdio: "inherit",
		encoding: "utf8",
		timeout: 600000,
	});
	const elapsed = performance.now() - start;
	return { ...result, elapsed, command };
};

const results = [];
for (const task of tasks) {
	console.log(`\n[benchmark] ${task.name}`);
	const result = run(task.command);

	results.push({
		name: task.name,
		category: task.category,
		command: task.command,
		ok: result.status === 0,
		timeMs: result.elapsed,
	});

	if (result.error) {
		console.error(`[benchmark:error] ${task.command}`, result.error.message);
	}
	if (result.status !== 0) {
		console.error(
			`[benchmark] ${task.name} failed with exit code ${result.status}`,
		);
	}
}

const formatRows = results.filter((row) => row.category === "format");
const lintRows = results.filter((row) => row.category === "lint");

const maxNameLength = Math.max(...results.map((r) => r.name.length));
const logRow = (row) => {
	const ok = row.ok ? "ok" : "fail";
	console.log(
		`${row.name.padEnd(maxNameLength + 2)} | ${format(row.timeMs)} | ${ok}`,
	);
};

console.log("\n[benchmark] summary");
console.log("name                 | time    | status");
console.log("-------------------- | ------- | ------");
for (const row of results) logRow(row);

if (formatRows.length === 2 && lintRows.length === 2) {
	const biomeFormat =
		formatRows.find((row) => row.name === "Biome format")?.timeMs ?? 0;
	const ttscFormat =
		formatRows.find((row) => row.name === "ttsc format")?.timeMs ?? 0;
	const biomeLint =
		lintRows.find((row) => row.name === "Biome lint")?.timeMs ?? 0;
	const ttscLint =
		lintRows.find((row) => row.name === "ttsc lint")?.timeMs ?? 0;

	if (biomeFormat > 0 && ttscFormat > 0) {
		const ratio = ttscFormat / biomeFormat;
		console.log(
			`\n[benchmark] format: ttsc ${format(ttscFormat)} / biome ${format(
				biomeFormat,
			)} = ${ratio.toFixed(2)}x`,
		);
	}
	if (biomeLint > 0 && ttscLint > 0) {
		const ratio = ttscLint / biomeLint;
		console.log(
			`[benchmark] lint: ttsc ${format(ttscLint)} / biome ${format(
				biomeLint,
			)} = ${ratio.toFixed(2)}x`,
		);
	}
}
