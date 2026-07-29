import { describe, expect, test } from "bun:test";
import {
	assertRuntimeOperationProjection,
	campaignCancelOperationSpec,
	campaignGetOperationSpec,
	campaignPreflightOperationSpec,
	campaignResource,
	campaignSafeStartPlaybook,
	campaignScheduleOperationSpec,
	campaignStartOperationSpec,
	defineEmailOperationsSpec,
	defineOperationPlaybook,
	defineOperationSpec,
	defineOperationResourceSpec,
	emailOperationsSpec,
	expectedPolicyForEffects,
	messageResource,
	projectOperationSpec,
	subscriberBlocklistOperationSpec,
	subscriberResource,
	transactionalSendOperationSpec,
	webhookDispatchOperationSpec,
	webhookOperationSpecs,
} from "../src/specs";

describe("email operations specification", () => {
	test("models pilot and high-risk operations as normalized typed contracts", () => {
		expect(emailOperationsSpec.operations.map(({ id }) => id)).toEqual([
			"campaigns.get",
			"campaigns.schedule",
			"subscribers.blocklist",
			"campaigns.start",
			"campaigns.cancel",
			"transactional.send",
			"ops.campaign.preflight",
			"specs.search",
			"specs.describe",
			"playbooks.list",
			"playbooks.get",
			"control.capabilities",
			"control.prime",
			"control.status",
			"webhooks.list",
			"webhooks.create",
			"webhooks.update",
			"webhooks.delete",
			"webhooks.test",
			"webhooks.dispatch",
			"webhooks.delivery.list",
			"webhooks.delivery.retry",
		]);
		expect(campaignGetOperationSpec.contract.input).toMatchObject({
			dialect: "openapi-3.1",
			stage: "normalized",
			schema: {
				type: "object",
				required: ["id"],
			},
		});
		expect(
			subscriberBlocklistOperationSpec.contract.input.schema.required,
		).toEqual([
			"subscriber_ids",
			"dry_run",
			"max_items",
			"continue_on_error",
		]);
		expect(campaignScheduleOperationSpec.retry).toEqual(
			expect.objectContaining({
				kind: "reconcile",
				reconcileWith: "campaigns.get",
				idempotent: true,
			}),
		);
		expect(campaignScheduleOperationSpec.agent.prerequisites).toContain(
			"ops.campaign.preflight",
		);
		expect(transactionalSendOperationSpec.retry).toMatchObject({
			kind: "conditional",
		});
		expect(campaignStartOperationSpec.state).toEqual({
			resource: "campaign",
			from: ["draft", "scheduled", "paused"],
			to: "running",
			allowNoopFromTarget: true,
		});
		expect(campaignCancelOperationSpec.state?.to).toBe("cancelled");
		expect(
			campaignPreflightOperationSpec.contract.output.schema.type,
		).toBe("object");
		expect(
			campaignPreflightOperationSpec.contract.output.schema.properties
				?.checkedAt,
		).toEqual({ $ref: "#/components/schemas/IsoDateTime" });
		expect(
			campaignPreflightOperationSpec.contract.output.components?.schemas
				?.IsoDateTime,
		).toMatchObject({ type: "string", format: "date-time" });
		expect(webhookOperationSpecs).toHaveLength(8);
		expect(webhookDispatchOperationSpec.effects).toEqual([
			{ kind: "webhook", resource: "webhook", audience: "batch" },
		]);
		expect(emailOperationsSpec.events.map((event) => event.type)).toContain(
			"operation.succeeded",
		);
		expect(emailOperationsSpec.events.map((event) => event.type)).toContain(
			"abtest.winner-selected",
		);
	});

	test("derives safety requirements from operation effects", () => {
		expect(expectedPolicyForEffects([{ kind: "read", resource: "campaign" }]))
			.toEqual({
				confirmation: "never",
				audit: "optional",
				dryRun: false,
			});
		expect(
			expectedPolicyForEffects([
				{
					kind: "delivery",
					resource: "campaign",
					audience: "bulk",
					timing: "scheduled",
				},
			]),
		).toEqual({
			confirmation: "required",
			audit: "required",
			dryRun: false,
		});
		expect(
			expectedPolicyForEffects([
				{
					kind: "delivery",
					resource: "message",
					audience: "single",
					timing: "immediate",
				},
			]),
		).toEqual({
			confirmation: "never",
			audit: "required",
			dryRun: false,
		});
		expect(
			expectedPolicyForEffects([
				{
					kind: "suppression",
					resource: "subscriber",
					scope: "audience",
					reversible: true,
				},
			]),
		).toEqual({
			confirmation: "required",
			audit: "required",
			dryRun: true,
		});
		expect(
			expectedPolicyForEffects([
				{ kind: "write", resource: "template", reversible: true },
			]),
		).toEqual({
			confirmation: "never",
			audit: "required",
			dryRun: false,
		});
		expect(
			expectedPolicyForEffects([
				{ kind: "write", resource: "template", reversible: false },
			]),
		).toEqual({
			confirmation: "required",
			audit: "required",
			dryRun: false,
		});
		expect(
			expectedPolicyForEffects([
				{ kind: "delete", resource: "campaign", reversible: false },
			]),
		).toEqual({
			confirmation: "required",
			audit: "required",
			dryRun: false,
		});
		expect(
			expectedPolicyForEffects([
				{
					kind: "delivery",
					resource: "campaign",
					audience: "bulk",
					timing: "scheduled",
				},
				{
					kind: "suppression",
					resource: "subscriber",
					scope: "audience",
					reversible: true,
				},
			]),
		).toEqual({
			confirmation: "required",
			audit: "required",
			dryRun: true,
		});
		expect(
			expectedPolicyForEffects([
				{ kind: "webhook", resource: "webhook", audience: "single" },
			]),
		).toEqual({
			confirmation: "required",
			audit: "required",
			dryRun: false,
		});
	});

	test("rejects duplicate identities and invalid resource transitions", () => {
		expect(() =>
			defineEmailOperationsSpec({
				schemaVersion: "test",
				title: "Duplicate",
				description: "Duplicate fixture",
				resources: [campaignResource, subscriberResource],
				operations: [
					campaignGetOperationSpec,
					campaignGetOperationSpec,
				],
				events: [],
				playbooks: [],
			}),
		).toThrow("duplicate operation id");

		expect(() =>
			defineEmailOperationsSpec({
				schemaVersion: "test",
				title: "Invalid transition",
				description: "Invalid transition fixture",
				resources: [campaignResource, subscriberResource],
				operations: [
					{
						...campaignScheduleOperationSpec,
						state: {
							resource: "campaign",
							from: ["finished"],
							to: "scheduled",
							allowNoopFromTarget: false,
						},
					},
				],
				events: [],
				playbooks: [],
			}),
		).toThrow("finished -> scheduled");
	});

	test("rejects invalid state machines and dangling playbook or event references", () => {
		expect(() =>
			defineOperationResourceSpec({
				id: "campaign",
				title: "Invalid terminal resource",
				states: ["draft", "finished"],
				transitions: {
					draft: ["finished"],
					finished: ["draft"],
				},
				terminalStates: ["finished"],
			}),
		).toThrow("must not have outgoing transitions");

		expect(() =>
			defineOperationSpec({
				...campaignScheduleOperationSpec,
				state: {
					...campaignScheduleOperationSpec.state,
					from: [],
				},
			}),
		).toThrow("at least one source state");

		expect(() =>
			defineOperationSpec({
				...campaignGetOperationSpec,
				verb: "list",
			}),
		).toThrow("id verb (get) must match declared verb (list)");

		expect(() =>
			defineOperationSpec({
				...campaignGetOperationSpec,
				effects: [{ kind: "read", resource: "subscriber" }],
			}),
		).toThrow(
			"effect resource (subscriber) must match operation resource (campaign)",
		);

		expect(() =>
			defineOperationSpec({
				...campaignScheduleOperationSpec,
				state: {
					...campaignScheduleOperationSpec.state,
					resource: "subscriber",
				},
			}),
		).toThrow(
			"state resource (subscriber) must match operation resource (campaign)",
		);

		expect(() =>
			defineOperationSpec({
				...campaignGetOperationSpec,
				projection: {
					...campaignGetOperationSpec.projection,
					graph: {
						...campaignGetOperationSpec.projection.graph,
						executorNode: " ",
					},
				},
			}),
		).toThrow("projection graph executorNode must not be blank");

		expect(() =>
			defineEmailOperationsSpec({
				schemaVersion: "test",
				title: "Raw invalid transition",
				description: "Raw operation fixture",
				resources: [campaignResource, subscriberResource],
				operations: [
					{
						...campaignScheduleOperationSpec,
						state: {
							...campaignScheduleOperationSpec.state,
							from: [],
						},
					},
				],
				events: [],
				playbooks: [],
			}),
		).toThrow("at least one source state");

		expect(() =>
			defineEmailOperationsSpec({
				schemaVersion: "test",
				title: "Dangling playbook",
				description: "Dangling playbook fixture",
				resources: [
					campaignResource,
					subscriberResource,
					messageResource,
				],
				operations: [campaignGetOperationSpec],
				events: [],
				playbooks: [
					{
						id: "campaign.invalid",
						title: "Invalid",
						goal: "Reference an unavailable operation",
						inputs: [],
						steps: [
							{
								id: "schedule",
								operation: "campaigns.schedule",
								approval: "human",
								description: "Unavailable in this schema",
								dependsOn: [],
								input: [],
							},
						],
						recoveryOperation: "campaigns.get",
					},
				],
			}),
		).toThrow("references unknown operation campaigns.schedule");

		expect(() =>
			defineEmailOperationsSpec({
				schemaVersion: "test",
				title: "Dangling event",
				description: "Dangling event fixture",
				resources: [campaignResource, subscriberResource],
				operations: [campaignGetOperationSpec],
				events: [
					{
						type: "provider.drifted",
						title: "Provider drifted",
						description: "Unknown resource fixture",
						source: "provider",
						subject: "provider",
						schemaVersion: 1,
					},
				],
				playbooks: [],
			}),
		).toThrow("references unknown resource provider");
	});

	test("defines a guarded human-approved campaign start playbook", () => {
		expect(emailOperationsSpec.playbooks).toEqual([
			campaignSafeStartPlaybook,
		]);
		expect(
			campaignSafeStartPlaybook.steps.map(
				({ id, operation, approval }) => ({
					id,
					operation,
					approval,
				}),
			),
		).toEqual([
			{
				id: "inspect",
				operation: "campaigns.get",
				approval: "none",
			},
			{
				id: "preflight",
				operation: "ops.campaign.preflight",
				approval: "none",
			},
			{
				id: "start",
				operation: "campaigns.start",
				approval: "human",
			},
			{
				id: "verify",
				operation: "campaigns.get",
				approval: "none",
			},
		]);
		expect(
			campaignSafeStartPlaybook.steps[1]?.resultGuard,
		).toMatchObject({
			path: "summary.fail",
			operator: "equals",
			expected: 0,
			onFailure: "stop",
		});
		expect(
			campaignSafeStartPlaybook.steps[1]?.input.map(
				({ parameter, source }) => ({ parameter, source }),
			),
		).toEqual([
			{
				parameter: "campaign_id",
				source: { kind: "playbook-input", name: "campaign_id" },
			},
			{
				parameter: "max_audience",
				source: { kind: "literal", value: 200_000 },
			},
			{
				parameter: "check_links",
				source: { kind: "literal", value: true },
			},
			{
				parameter: "link_check_timeout_ms",
				source: { kind: "literal", value: 4_000 },
			},
		]);

		expect(() =>
			defineOperationPlaybook({
				...campaignSafeStartPlaybook,
				steps: [
					{
						...campaignSafeStartPlaybook.steps[0],
						dependsOn: ["later"],
					},
				],
			}),
		).toThrow("depends on unavailable prior step later");

		expect(() =>
			defineEmailOperationsSpec({
				...emailOperationsSpec,
				playbooks: [
					{
						...campaignSafeStartPlaybook,
						steps: campaignSafeStartPlaybook.steps.map((step) =>
							step.id === "start"
								? { ...step, approval: "none" as const }
								: step,
						) as unknown as typeof campaignSafeStartPlaybook.steps,
					},
				],
			}),
		).toThrow("must require human approval");
	});

	test("keeps runtime metadata aligned while returning detached projections", () => {
		expect(() =>
			assertRuntimeOperationProjection(campaignGetOperationSpec, {
				id: campaignGetOperationSpec.id,
				title: campaignGetOperationSpec.title,
				description: campaignGetOperationSpec.description,
				mcpName: campaignGetOperationSpec.projection.mcpName,
				safety: {
					readOnlyHint: true,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: true,
				},
			}),
		).not.toThrow();
		expect(() =>
			assertRuntimeOperationProjection(campaignGetOperationSpec, {
				id: campaignGetOperationSpec.id,
				title: "Drifted",
				description: campaignGetOperationSpec.description,
				mcpName: campaignGetOperationSpec.projection.mcpName,
				safety: {
					readOnlyHint: true,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: true,
				},
			}),
		).toThrow("title drifted");

		expect(() =>
			assertRuntimeOperationProjection(
				{
					...campaignScheduleOperationSpec,
					retry: {
						...campaignScheduleOperationSpec.retry,
						idempotent: false,
					},
				},
				{
					id: campaignScheduleOperationSpec.id,
					title: campaignScheduleOperationSpec.title,
					description: campaignScheduleOperationSpec.description,
					mcpName: campaignScheduleOperationSpec.projection.mcpName,
					safety: {
						readOnlyHint: false,
						destructiveHint: true,
						idempotentHint: false,
						openWorldHint: true,
					},
				},
			),
		).not.toThrow();

		const projected = projectOperationSpec(
			subscriberBlocklistOperationSpec,
		);
		expect(projected).toEqual(subscriberBlocklistOperationSpec);
		expect(projected).not.toBe(subscriberBlocklistOperationSpec);
	});
});
