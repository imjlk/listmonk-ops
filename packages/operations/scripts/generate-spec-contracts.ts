import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import typia from "typia";
import type {
	CampaignGetInput,
	CampaignGetOutput,
	CampaignLifecycleInput,
	CampaignLifecycleOutput,
	CampaignPreflightInput,
	CampaignPreflightOutput,
	CampaignScheduleInput,
	CampaignScheduleOutput,
	ControlCapabilitiesOutput,
	ControlPrimeInput,
	ControlPrimeOutput,
	ControlStatusInput,
	ControlStatusOutput,
	EmptyInput,
	PlaybookGetInput,
	PlaybookGetOutput,
	PlaybookListOutput,
	SpecDescribeInput,
	SpecDescribeOutput,
	SpecSearchInput,
	SpecSearchOutput,
	SubscriberBlocklistInput,
	SubscriberBulkOutput,
	TransactionalSendInput,
	TransactionalSendOutput,
	WebhookCreateInput,
	WebhookCreateOutput,
	WebhookDeleteInput,
	WebhookDeleteOutput,
	WebhookCircuitResetInput,
	WebhookCircuitResetOutput,
	WebhookDeliveryListInput,
	WebhookDeliveryListOutput,
	WebhookDeliveryRetryInput,
	WebhookDeliveryRetryOutput,
	WebhookDlqListInput,
	WebhookDlqListOutput,
	WebhookDlqReplayInput,
	WebhookDlqReplayOutput,
	WebhookDispatchInput,
	WebhookDispatchOutput,
	WebhookListInput,
	WebhookListOutput,
	WebhookInboundIngestInput,
	WebhookInboundIngestOutput,
	WebhookPruneInput,
	WebhookPruneOutput,
	WebhookReconcileInput,
	WebhookReconcileOutput,
	WebhookTestInput,
	WebhookTestOutput,
	WebhookTickInput,
	WebhookTickOutput,
	WebhookRuntimeStatusInput,
	WebhookRuntimeStatusOutput,
	WebhookUpdateInput,
	WebhookUpdateOutput,
} from "./spec-contracts";
import type { NormalizedContractSchema } from "../src/specs/json";

const outputPath = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../src/specs/generated/contract-schemas.json",
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
}): NormalizedContractSchema {
	return {
		dialect: "openapi-3.1",
		stage: "normalized",
		schema: stableRecord(generated.schema, "contract schema"),
		components: stableRecord(generated.components, "contract components"),
	};
}

// Keep this map aligned with the normalized contract types above and the
// typed accessors in ../src/specs/contract-schemas.ts.
const contracts = {
	campaignGetInputContract: contractSchema(
		typia.json.schema<CampaignGetInput>(),
	),
	campaignGetOutputContract: contractSchema(
		typia.json.schema<CampaignGetOutput>(),
	),
	campaignLifecycleInputContract: contractSchema(
		typia.json.schema<CampaignLifecycleInput>(),
	),
	campaignLifecycleOutputContract: contractSchema(
		typia.json.schema<CampaignLifecycleOutput>(),
	),
	campaignPreflightInputContract: contractSchema(
		typia.json.schema<CampaignPreflightInput>(),
	),
	campaignPreflightOutputContract: contractSchema(
		typia.json.schema<CampaignPreflightOutput>(),
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
	transactionalSendInputContract: contractSchema(
		typia.json.schema<TransactionalSendInput>(),
	),
	transactionalSendOutputContract: contractSchema(
		typia.json.schema<TransactionalSendOutput>(),
	),
	specSearchInputContract: contractSchema(typia.json.schema<SpecSearchInput>()),
	specSearchOutputContract: contractSchema(
		typia.json.schema<SpecSearchOutput>(),
	),
	specDescribeInputContract: contractSchema(
		typia.json.schema<SpecDescribeInput>(),
	),
	specDescribeOutputContract: contractSchema(
		typia.json.schema<SpecDescribeOutput>(),
	),
	emptyInputContract: contractSchema(typia.json.schema<EmptyInput>()),
	playbookListOutputContract: contractSchema(
		typia.json.schema<PlaybookListOutput>(),
	),
	playbookGetInputContract: contractSchema(
		typia.json.schema<PlaybookGetInput>(),
	),
	playbookGetOutputContract: contractSchema(
		typia.json.schema<PlaybookGetOutput>(),
	),
	controlCapabilitiesOutputContract: contractSchema(
		typia.json.schema<ControlCapabilitiesOutput>(),
	),
	controlPrimeInputContract: contractSchema(
		typia.json.schema<ControlPrimeInput>(),
	),
	controlPrimeOutputContract: contractSchema(
		typia.json.schema<ControlPrimeOutput>(),
	),
	controlStatusInputContract: contractSchema(
		typia.json.schema<ControlStatusInput>(),
	),
	controlStatusOutputContract: contractSchema(
		typia.json.schema<ControlStatusOutput>(),
	),
	webhookListInputContract: contractSchema(
		typia.json.schema<WebhookListInput>(),
	),
	webhookListOutputContract: contractSchema(
		typia.json.schema<WebhookListOutput>(),
	),
	webhookCreateInputContract: contractSchema(
		typia.json.schema<WebhookCreateInput>(),
	),
	webhookCreateOutputContract: contractSchema(
		typia.json.schema<WebhookCreateOutput>(),
	),
	webhookUpdateInputContract: contractSchema(
		typia.json.schema<WebhookUpdateInput>(),
	),
	webhookUpdateOutputContract: contractSchema(
		typia.json.schema<WebhookUpdateOutput>(),
	),
	webhookDeleteInputContract: contractSchema(
		typia.json.schema<WebhookDeleteInput>(),
	),
	webhookDeleteOutputContract: contractSchema(
		typia.json.schema<WebhookDeleteOutput>(),
	),
	webhookTestInputContract: contractSchema(
		typia.json.schema<WebhookTestInput>(),
	),
	webhookTestOutputContract: contractSchema(
		typia.json.schema<WebhookTestOutput>(),
	),
	webhookDispatchInputContract: contractSchema(
		typia.json.schema<WebhookDispatchInput>(),
	),
	webhookDispatchOutputContract: contractSchema(
		typia.json.schema<WebhookDispatchOutput>(),
	),
	webhookDeliveryListInputContract: contractSchema(
		typia.json.schema<WebhookDeliveryListInput>(),
	),
	webhookDeliveryListOutputContract: contractSchema(
		typia.json.schema<WebhookDeliveryListOutput>(),
	),
	webhookDeliveryRetryInputContract: contractSchema(
		typia.json.schema<WebhookDeliveryRetryInput>(),
	),
	webhookDeliveryRetryOutputContract: contractSchema(
		typia.json.schema<WebhookDeliveryRetryOutput>(),
	),
	webhookReconcileInputContract: contractSchema(
		typia.json.schema<WebhookReconcileInput>(),
	),
	webhookReconcileOutputContract: contractSchema(
		typia.json.schema<WebhookReconcileOutput>(),
	),
	webhookPruneInputContract: contractSchema(
		typia.json.schema<WebhookPruneInput>(),
	),
	webhookPruneOutputContract: contractSchema(
		typia.json.schema<WebhookPruneOutput>(),
	),
	webhookTickInputContract: contractSchema(
		typia.json.schema<WebhookTickInput>(),
	),
	webhookTickOutputContract: contractSchema(
		typia.json.schema<WebhookTickOutput>(),
	),
	webhookRuntimeStatusInputContract: contractSchema(
		typia.json.schema<WebhookRuntimeStatusInput>(),
	),
	webhookRuntimeStatusOutputContract: contractSchema(
		typia.json.schema<WebhookRuntimeStatusOutput>(),
	),
	webhookInboundIngestInputContract: contractSchema(
		typia.json.schema<WebhookInboundIngestInput>(),
	),
	webhookInboundIngestOutputContract: contractSchema(
		typia.json.schema<WebhookInboundIngestOutput>(),
	),
	webhookDlqListInputContract: contractSchema(
		typia.json.schema<WebhookDlqListInput>(),
	),
	webhookDlqListOutputContract: contractSchema(
		typia.json.schema<WebhookDlqListOutput>(),
	),
	webhookDlqReplayInputContract: contractSchema(
		typia.json.schema<WebhookDlqReplayInput>(),
	),
	webhookDlqReplayOutputContract: contractSchema(
		typia.json.schema<WebhookDlqReplayOutput>(),
	),
	webhookCircuitResetInputContract: contractSchema(
		typia.json.schema<WebhookCircuitResetInput>(),
	),
	webhookCircuitResetOutputContract: contractSchema(
		typia.json.schema<WebhookCircuitResetOutput>(),
	),
} satisfies Record<string, NormalizedContractSchema>;

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
			"Generated contract schemas are stale. Run `bun run --cwd packages/operations generate:specs`.",
		);
	}
} else {
	await writeFile(outputPath, expected);
}
