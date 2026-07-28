import { describe, expect, test } from "bun:test";
import {
	assertRuntimeOperationProjection,
	campaignGetProductOperation,
	campaignResource,
	campaignScheduleProductOperation,
	defineEmailOperationsProductSchema,
	defineProductOperation,
	defineProductResource,
	emailOperationsProductSchema,
	expectedPolicyForEffects,
	projectProductOperation,
	subscriberBlocklistProductOperation,
	subscriberResource,
} from "../src";

describe("email operations product schema", () => {
	test("models the three pilot operations as normalized typed contracts", () => {
		expect(emailOperationsProductSchema.operations.map(({ id }) => id)).toEqual([
			"campaigns.get",
			"campaigns.schedule",
			"subscribers.blocklist",
		]);
		expect(campaignGetProductOperation.contract.input).toMatchObject({
			dialect: "openapi-3.1",
			stage: "normalized",
			schema: {
				type: "object",
				required: ["id"],
			},
		});
		expect(
			subscriberBlocklistProductOperation.contract.input.schema.required,
		).toEqual([
			"subscriber_ids",
			"dry_run",
			"max_items",
			"continue_on_error",
		]);
		expect(campaignScheduleProductOperation.retry).toEqual(
			expect.objectContaining({
				kind: "reconcile",
				reconcileWith: "campaigns.get",
				idempotent: true,
			}),
		);
		expect(campaignScheduleProductOperation.agent.prerequisites).toContain(
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
			defineEmailOperationsProductSchema({
				schemaVersion: "test",
				title: "Duplicate",
				description: "Duplicate fixture",
				resources: [campaignResource, subscriberResource],
				operations: [
					campaignGetProductOperation,
					campaignGetProductOperation,
				],
				events: [],
				playbooks: [],
			}),
		).toThrow("duplicate operation id");

		expect(() =>
			defineEmailOperationsProductSchema({
				schemaVersion: "test",
				title: "Invalid transition",
				description: "Invalid transition fixture",
				resources: [campaignResource, subscriberResource],
				operations: [
					{
						...campaignScheduleProductOperation,
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
			defineProductResource({
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
			defineProductOperation({
				...campaignScheduleProductOperation,
				state: {
					...campaignScheduleProductOperation.state,
					from: [],
				},
			}),
		).toThrow("at least one source state");

		expect(() =>
			defineProductOperation({
				...campaignGetProductOperation,
				projection: {
					...campaignGetProductOperation.projection,
					graph: {
						...campaignGetProductOperation.projection.graph,
						executorNode: " ",
					},
				},
			}),
		).toThrow("projection graph executorNode must not be blank");

		expect(() =>
			defineEmailOperationsProductSchema({
				schemaVersion: "test",
				title: "Raw invalid transition",
				description: "Raw operation fixture",
				resources: [campaignResource, subscriberResource],
				operations: [
					{
						...campaignScheduleProductOperation,
						state: {
							...campaignScheduleProductOperation.state,
							from: [],
						},
					},
				],
				events: [],
				playbooks: [],
			}),
		).toThrow("at least one source state");

		expect(() =>
			defineEmailOperationsProductSchema({
				schemaVersion: "test",
				title: "Dangling playbook",
				description: "Dangling playbook fixture",
				resources: [campaignResource, subscriberResource],
				operations: [campaignGetProductOperation],
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
			defineEmailOperationsProductSchema({
				schemaVersion: "test",
				title: "Dangling event",
				description: "Dangling event fixture",
				resources: [campaignResource, subscriberResource],
				operations: [campaignGetProductOperation],
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
			assertRuntimeOperationProjection(campaignGetProductOperation, {
				id: campaignGetProductOperation.id,
				title: campaignGetProductOperation.title,
				description: campaignGetProductOperation.description,
				mcpName: campaignGetProductOperation.projection.mcpName,
				safety: {
					readOnlyHint: true,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: true,
				},
			}),
		).not.toThrow();
		expect(() =>
			assertRuntimeOperationProjection(campaignGetProductOperation, {
				id: campaignGetProductOperation.id,
				title: "Drifted",
				description: campaignGetProductOperation.description,
				mcpName: campaignGetProductOperation.projection.mcpName,
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
					...campaignScheduleProductOperation,
					retry: {
						...campaignScheduleProductOperation.retry,
						idempotent: false,
					},
				},
				{
					id: campaignScheduleProductOperation.id,
					title: campaignScheduleProductOperation.title,
					description: campaignScheduleProductOperation.description,
					mcpName: campaignScheduleProductOperation.projection.mcpName,
					safety: {
						readOnlyHint: false,
						destructiveHint: true,
						idempotentHint: false,
						openWorldHint: true,
					},
				},
			),
		).not.toThrow();

		const projected = projectProductOperation(
			subscriberBlocklistProductOperation,
		);
		expect(projected).toEqual(subscriberBlocklistProductOperation);
		expect(projected).not.toBe(subscriberBlocklistProductOperation);
	});
});
