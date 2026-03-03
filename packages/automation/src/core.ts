import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type RecordValue = Record<string, unknown>;

export function isRecord(value: unknown): value is RecordValue {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toPositiveInt(value: unknown): number | undefined {
	const num = typeof value === "number" ? value : Number(value);
	if (!Number.isInteger(num) || num <= 0) {
		return undefined;
	}
	return num;
}

export function extractResults<T>(payload: unknown): T[] {
	if (Array.isArray(payload)) {
		return payload as T[];
	}

	if (isRecord(payload) && Array.isArray(payload.results)) {
		return payload.results as T[];
	}

	return [];
}

export function toDate(value: string | undefined): Date | undefined {
	if (!value) {
		return undefined;
	}

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return undefined;
	}

	return date;
}

export async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
	try {
		const raw = await readFile(path, "utf8");
		return JSON.parse(raw) as T;
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			return fallback;
		}
		throw error;
	}
}

export async function writeJsonFile(
	path: string,
	value: unknown,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const DEFAULT_DATA_DIR = join(
	process.env.HOME || process.cwd(),
	".listmonk-ops",
	"ops",
);

export const SEGMENT_STORE_PATH =
	process.env.LISTMONK_OPS_SEGMENT_STORE ||
	join(DEFAULT_DATA_DIR, "segment-drift.json");

export const TEMPLATE_REGISTRY_PATH =
	process.env.LISTMONK_OPS_TEMPLATE_REGISTRY ||
	join(DEFAULT_DATA_DIR, "template-registry.json");

export function getOpsStorePaths() {
	return {
		segmentStorePath: SEGMENT_STORE_PATH,
		templateRegistryPath: TEMPLATE_REGISTRY_PATH,
	};
}
