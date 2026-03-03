import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AbTest } from "@listmonk-ops/abtest";

type AbTestStore = {
	version: 1;
	tests: AbTest[];
};

const DEFAULT_STORE_PATH = join(
	process.env.HOME || process.cwd(),
	".listmonk-ops",
	"abtests.json",
);

export function getAbTestStorePath(): string {
	const overriddenPath = process.env.LISTMONK_OPS_ABTEST_STORE?.trim();
	return overriddenPath && overriddenPath.length > 0
		? overriddenPath
		: DEFAULT_STORE_PATH;
}

function isEnoentError(error: unknown): error is NodeJS.ErrnoException {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "ENOENT"
	);
}

export async function loadStoredTests(): Promise<AbTest[]> {
	const storePath = getAbTestStorePath();

	try {
		const raw = await readFile(storePath, "utf8");
		const parsed = JSON.parse(raw) as Partial<AbTestStore> | null;
		if (!parsed || !Array.isArray(parsed.tests)) {
			return [];
		}
		return parsed.tests;
	} catch (error) {
		if (isEnoentError(error)) {
			return [];
		}
		throw error;
	}
}

export async function saveStoredTests(tests: AbTest[]): Promise<void> {
	const storePath = getAbTestStorePath();
	const payload: AbTestStore = {
		version: 1,
		tests,
	};

	await mkdir(dirname(storePath), { recursive: true });
	await writeFile(storePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
