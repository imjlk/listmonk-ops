import { describe, expect, test } from "bun:test";
import {
	assertRuntimeOperationProjection,
	campaignGetOperationSpec,
	campaignResource,
	campaignScheduleOperationSpec,
	defineEmailOperationsSpec,
	defineOperationSpec,
	defineOperationResourceSpec,
	emailOperationsSpec,
	expectedPolicyForEffects,
	projectOperationSpec,
	subscriberBlocklistOperationSpec,
	subscriberResource,
} from "../src/specs";

describe("email operations specification", () => {
	test("models the three pilot operations as normalized typed contracts", () => {
		expect(emailOperationsSpec.operations.map(({ id }) => id)).toEqual([
			"campaigns.get",
			"campaigns.schedule",
			"subscribers.blocklist",
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
				resources: [campaignResource, subscriberResource],
				operations: [campaignGetOperationSpec],
				events: [],
				playbooks: [
					{
						id: "campaign.invalid",
						title: "Invalid",
						goal: "Reference an unavailable operation",
						steps: [
							{
								id: "schedule",
								operation: "campaigns.schedule",
								approval: "human",
								description: "Unavailable in this schema",
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
