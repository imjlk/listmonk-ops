import {
	getListmonkDataDirectory,
	resolveConfiguredPath,
} from "@listmonk-ops/common";
import { join } from "node:path";

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

/**
 * Explicit overrides follow the shared path rule (`~/` expansion, relative
 * paths from the home directory) so CLI and MCP processes with different
 * working directories use the same files.
 */
export function getOpsStorePaths() {
	const dataDirectory = join(getListmonkDataDirectory(), "ops");
	const segmentStore = process.env.LISTMONK_OPS_SEGMENT_STORE?.trim();
	const templateRegistry = process.env.LISTMONK_OPS_TEMPLATE_REGISTRY?.trim();
	return {
		segmentStorePath: segmentStore
			? resolveConfiguredPath(segmentStore)
			: join(dataDirectory, "segment-drift.json"),
		templateRegistryPath: templateRegistry
			? resolveConfiguredPath(templateRegistry)
			: join(dataDirectory, "template-registry.json"),
	};
}
