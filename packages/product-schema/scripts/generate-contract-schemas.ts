import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import typia from "typia";
import type {
	CampaignGetInput,
	CampaignGetOutput,
	CampaignScheduleInput,
	CampaignScheduleOutput,
	SubscriberBlocklistInput,
	SubscriberBulkOutput,
} from "../src/contracts";
import type { ProductContractSchema } from "../src/json";

const outputPath = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../src/generated/contract-schemas.json",
);
const checkOnly = process.argv.includes("--check");

function stableValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(stableValue);
	}
	if (typeof value === "object" && value !== null) {
		return Object.fromEntries(
			Object.entries(value)
				.sort(([left], [right]) =>
					left < right ? -1 : left > right ? 1 : 0,
				)
				.map(([key, nested]) => [key, stableValue(nested)]),
		);
	}
	return value;
}

function stableRecord(
	value: unknown,
	label: string,
): Readonly<Record<string, unknown>> {
	const stable = stableValue(value);
	if (typeof stable !== "object" || stable === null || Array.isArray(stable)) {
		throw new TypeError(
			`Typia generated non-object ${label}: ${JSON.stringify(stable)}`,
		);
	}
	return stable as Readonly<Record<string, unknown>>;
}

function contractSchema(generated: {
	schema: unknown;
	components: unknown;
}): ProductContractSchema {
	return {
		dialect: "openapi-3.1",
		stage: "normalized",
		schema: stableRecord(generated.schema, "contract schema"),
		components: stableRecord(generated.components, "contract components"),
	};
}

// Keep this map aligned with the normalized contract types above and the
// typed accessors in ../src/contract-schemas.ts.
const contracts = {
	campaignGetInputContract: contractSchema(
		typia.json.schema<CampaignGetInput>(),
	),
	campaignGetOutputContract: contractSchema(
		typia.json.schema<CampaignGetOutput>(),
	),
	campaignScheduleInputContract: contractSchema(
		typia.json.schema<CampaignScheduleInput>(),
	),
	campaignScheduleOutputContract: contractSchema(
		typia.json.schema<CampaignScheduleOutput>(),
	),
	subscriberBlocklistInputContract: contractSchema(
		typia.json.schema<SubscriberBlocklistInput>(),
	),
	subscriberBulkOutputContract: contractSchema(
		typia.json.schema<SubscriberBulkOutput>(),
	),
} satisfies Record<string, ProductContractSchema>;

function renderContracts(): string {
	return `${JSON.stringify(stableValue(contracts), null, 2)}\n`;
}

const expected = renderContracts();
let current: string | undefined;
try {
	current = await readFile(outputPath, "utf8");
} catch {
	current = undefined;
}
if (checkOnly) {
	if (current !== expected) {
		throw new Error(
			"Generated contract schemas are stale. Run `bun run --cwd packages/product-schema generate`.",
		);
	}
} else {
	await writeFile(outputPath, expected);
}
