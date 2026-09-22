import { describe, expect, test } from "bun:test";
import { campaignPreflightOperation } from "../src/ops-operations";
import {
	sequenceCreateOperation,
	sequenceEnrollOperation,
} from "../src/sequence-operations";
import { webhookCreateOperation } from "../src/webhook-operations";

describe("coerced operation input metadata", () => {
	test("retains required preflight ID while preserving optional defaults", () => {
		expect(campaignPreflightOperation.inputJsonSchema.required).toEqual(["campaign_id"]);
		expect(campaignPreflightOperation.inputSchema.safeParse({}).success).toBe(false);
		expect(campaignPreflightOperation.inputSchema.parse({ campaign_id: "42" })).toMatchObject({ campaign_id: 42, max_audience: 200_000 });
	});

	test("retains required enrollment IDs and nested wait durations", () => {
		expect(sequenceEnrollOperation.inputJsonSchema.required).toEqual(["id", "subscriber_id"]);
		type StepSchema = { properties?: { type?: { const?: string } }; required?: string[] };
		const steps = sequenceCreateOperation.inputJsonSchema.properties?.steps as {
			items: { oneOf?: StepSchema[]; anyOf?: StepSchema[] };
		};
		const wait = (steps.items.oneOf ?? steps.items.anyOf ?? []).find((step) => step.properties?.type?.const === "wait");
		expect(wait?.required).toEqual(["id", "type", "duration_seconds"]);
		expect(sequenceCreateOperation.inputSchema.safeParse({ name: "Sequence", steps: [{ id: "wait", type: "wait" }] }).success).toBe(false);
	});

	test("keeps webhook defaulted coercions optional", () => {
		expect(webhookCreateOperation.inputJsonSchema.required).toEqual(["name", "url", "secret_ref", "event_filters"]);
		const parsed = webhookCreateOperation.inputSchema.parse({
			name: "Webhook", url: "https://example.com/hook", secret_ref: "LISTMONK_OPS_WEBHOOK_SECRET",
			event_filters: ["*"], enabled: "true", timeout_ms: "5000",
		});
		expect(parsed.enabled).toBe(true);
		expect(parsed.timeout_ms).toBe(5000);
	});
});
