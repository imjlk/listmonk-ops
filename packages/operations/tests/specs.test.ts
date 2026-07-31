import { describe, expect, test } from "bun:test";
import {
	assertRuntimeOperationContracts,
	assertRuntimeOperationProjection,
	bridgedOperationSpecsById,
	campaignCancelOperationSpec,
	campaignGetOperationSpec,
	campaignPreflightOperationSpec,
	campaignResource,
	campaignSafeStartPlaybook,
	campaignScheduleOperationSpec,
	campaignStartOperationSpec,
	catalogReadOperationSpecs,
	coreReadOperationSpecs,
	controlStatusOperationSpec,
	defineEmailOperationsSpec,
	defineOperationPlaybook,
	defineOperationSpec,
	defineOperationResourceSpec,
	emailOperationsSpec,
	expectedPolicyForEffects,
	experimentResource,
	messageResource,
	projectOperationSpec,
	providerOperationSpecs,
	runtimeOperationContractIds,
	sequenceOperationSpecs,
	subscriberBlocklistOperationSpec,
	subscribersListOperationSpec,
	subscriberResource,
	templatesListOperationSpec,
	transactionalSendOperationSpec,
	webhookDispatchOperationSpec,
	webhookOperationSpecs,
	webhookPruneOperationSpec,
	webhookReconcileOperationSpec,
} from "../src/specs";
import { assertTypeScriptContractCompatibility } from "../src/specs/schema-compatibility";
import type { NormalizedContractSchema } from "../src/specs/json";
import type { PolicyForEffects } from "../src/specs/policy";
import { stableValue } from "../src/specs/stable-json.js";

type IsNever<Value> = [Value] extends [never] ? true : false;
const conflictingPreviewDryRunIsNever: IsNever<
	PolicyForEffects<
		readonly [
			{
				readonly kind: "write";
				readonly resource: "experiment";
				readonly reversible: false;
				readonly preview: true;
			},
			{
				readonly kind: "delivery";
				readonly resource: "campaign";
				readonly audience: "bulk";
				readonly timing: "immediate";
				readonly preview: false;
			},
		]
	>["dryRun"]
> = true;

describe("email operations specification", () => {
	test("normalizes contract JSON through one deterministic implementation", () => {
		expect(
			JSON.stringify(
				stableValue({
					z: 2,
					$schema: "https://json-schema.org/draft/2020-12/schema",
					a: {
						ignored: undefined,
						value: 1,
					},
				}),
			),
		).toBe('{"a":{"value":1},"z":2}');
	});

	test("models every public shared operation with governed contracts", () => {
		const operationIds = emailOperationsSpec.operations.map(({ id }) => id);
		expect(operationIds).toHaveLength(102);
		expect(new Set(operationIds).size).toBe(102);
		expect(
			runtimeOperationContractIds.every((operationId) =>
				operationIds.includes(operationId),
			),
		).toBe(true);
		expect(
			emailOperationsSpec.operations.filter(
				(operation) => operation.stability === "stable",
			),
		).toHaveLength(23);
		expect(coreReadOperationSpecs).toHaveLength(10);
		expect(
			coreReadOperationSpecs.every(
				(operation) =>
					operation.stability === "stable" &&
					operation.contract.input.source === "typescript" &&
					operation.contract.output.source === "typescript" &&
					!runtimeOperationContractIds.includes(
						operation.id as (typeof runtimeOperationContractIds)[number],
					),
			),
		).toBe(true);
		expect(catalogReadOperationSpecs).toHaveLength(6);
		expect(
			catalogReadOperationSpecs.every(
				(operation) =>
					operation.stability === "stable" &&
					operation.contract.input.source === "typescript" &&
					operation.contract.output.source === "typescript" &&
					operation.effects.every((effect) => effect.kind === "read") &&
					operation.retry.kind === "safe" &&
					operation.projection.openWorld === false,
			),
		).toBe(true);
		expect(controlStatusOperationSpec).toMatchObject({
			stability: "experimental",
			projection: { openWorld: true },
		});
		expect(
			subscribersListOperationSpec.contract.input.schema.required,
		).toEqual([]);
		expect(
			templatesListOperationSpec.contract.input.schema.required,
		).toEqual([]);
		expect(
			emailOperationsSpec.operations
				.filter((operation) =>
					runtimeOperationContractIds.includes(
						operation.id as (typeof runtimeOperationContractIds)[number],
					),
				)
				.every(
					(operation) =>
						operation.stability === "experimental" &&
						operation.contract.input.source === "runtime-operation" &&
						operation.contract.output.source === "runtime-operation",
				),
		).toBe(true);
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
		expect(webhookOperationSpecs).toHaveLength(16);
		expect(sequenceOperationSpecs).toHaveLength(14);
		expect(providerOperationSpecs).toHaveLength(7);
		expect(webhookDispatchOperationSpec.effects).toEqual([
			{ kind: "webhook", resource: "webhook", audience: "bulk" },
		]);
		expect(webhookReconcileOperationSpec.effects).toEqual([
			{
				kind: "maintenance",
				resource: "webhook",
				action: "recover",
				destructive: false,
			},
		]);
		expect(webhookPruneOperationSpec.effects).toEqual([
			{
				kind: "maintenance",
				resource: "webhook",
				action: "prune",
				destructive: true,
			},
		]);
		expect(
			bridgedOperationSpecsById["ops.subscribers.hygiene"].effects,
		).toEqual([
			{
				kind: "write",
				resource: "subscriber",
				reversible: true,
				preview: true,
			},
			{
				kind: "suppression",
				resource: "subscriber",
				scope: "audience",
				reversible: false,
				preview: true,
			},
		]);
		expect(
			bridgedOperationSpecsById["abtest.deploy-winner"].effects,
		).toEqual(
			expect.arrayContaining([
				{ kind: "write", resource: "campaign", reversible: true },
			]),
		);
		expect(bridgedOperationSpecsById["abtest.run"].effects).toEqual(
			expect.arrayContaining([
				{ kind: "write", resource: "campaign", reversible: true },
			]),
		);
		expect(bridgedOperationSpecsById["abtest.tick"].effects).toEqual(
			expect.arrayContaining([
				{
					kind: "write",
					resource: "campaign",
					reversible: true,
					preview: true,
				},
			]),
		);
		expect(
			bridgedOperationSpecsById["abtest.reconcile"].policy.dryRun,
		).toBe(false);
		expect(emailOperationsSpec.events.map((event) => event.type)).toContain(
			"operation.succeeded",
		);
		expect(emailOperationsSpec.events.map((event) => event.type)).toContain(
			"abtest.winner-selected",
		);
		expect(
			emailOperationsSpec.events.map((event) => event.type),
		).not.toContain("list.created");
	});

	test("models runtime preview capabilities and experiment lifecycle effects", () => {
		for (const operationId of [
			"subscribers.add-to-lists",
			"subscribers.remove-from-lists",
			"subscribers.unblocklist",
			"abtest.tick",
		]) {
			expect(bridgedOperationSpecsById[operationId]?.policy.dryRun).toBe(
				true,
			);
		}
		expect(
			bridgedOperationSpecsById["ops.segments.drift"]?.policy.dryRun,
		).toBe(false);
		expect(
			bridgedOperationSpecsById["ops.templates.registry-promote"]?.retry,
		).toMatchObject({ kind: "unsafe" });

		const createSpec = bridgedOperationSpecsById["abtest.create"];
		const launchSpec = bridgedOperationSpecsById["abtest.launch"];
		for (const operation of [createSpec, launchSpec]) {
			expect(
				operation?.effects.find((effect) => effect.kind === "delivery"),
			).toMatchObject({ timing: "scheduled" });
		}
		expect(createSpec?.agent.prerequisites).not.toContain(
			"ops.campaign.preflight",
		);
		expect(createSpec?.agent.related).toContain("ops.campaign.preflight");
		expect(createSpec?.effects.map(({ resource }) => resource)).toEqual([
			"experiment",
			"campaign",
			"list",
			"campaign",
		]);
		expect(
			bridgedOperationSpecsById["abtest.stop"]?.effects.map(
				({ resource }) => resource,
			),
		).toEqual(["experiment", "campaign", "list"]);
		expect(
			bridgedOperationSpecsById["abtest.delete"]?.effects.map(
				({ resource }) => resource,
			),
		).toEqual(["experiment", "campaign", "list"]);

		expect(experimentResource.states).toEqual([
			"draft",
			"testing",
			"scheduled",
			"running",
			"analyzing",
			"deploying",
			"cancelling",
			"completed",
			"inconclusive",
			"failed",
			"cancelled",
		]);
	});

	test("derives safety requirements from operation effects", () => {
		expect(conflictingPreviewDryRunIsNever).toBe(true);
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
		expect(
			expectedPolicyForEffects([
				{
					kind: "maintenance",
					resource: "webhook",
					action: "recover",
					destructive: false,
				},
			]),
		).toEqual({
			confirmation: "never",
			audit: "required",
			dryRun: true,
		});
		expect(
			expectedPolicyForEffects([
				{
					kind: "maintenance",
					resource: "webhook",
					action: "prune",
					destructive: true,
				},
			]),
		).toEqual({
			confirmation: "required",
			audit: "required",
			dryRun: true,
		});
		expect(
			expectedPolicyForEffects([
				{
					kind: "write",
					resource: "subscriber",
					reversible: true,
					preview: true,
				},
			]),
		).toEqual({
			confirmation: "never",
			audit: "required",
			dryRun: true,
		});
		expect(
			expectedPolicyForEffects([
				{
					kind: "maintenance",
					resource: "audience",
					action: "recover",
					destructive: false,
					preview: false,
				},
			]),
		).toEqual({
			confirmation: "never",
			audit: "required",
			dryRun: false,
		});
		expect(() =>
			expectedPolicyForEffects([
				{
					kind: "write",
					resource: "experiment",
					reversible: false,
					preview: true,
				},
				{
					kind: "delivery",
					resource: "campaign",
					audience: "bulk",
					timing: "immediate",
					preview: false,
				},
			]),
		).toThrow("conflicting preview capabilities");
	});

	test("checks TypeScript-authored contracts against runtime boundary schemas", () => {
		const productInput = {
			dialect: "openapi-3.1",
			stage: "normalized",
			source: "typescript",
			schema: {
				type: "object",
				properties: {
					id: { type: "integer" },
					mode: { enum: ["safe"] },
				},
				required: ["id", "mode"],
			},
			components: {},
		} as const satisfies NormalizedContractSchema;
		const runtimeInput = {
			type: "object",
			properties: {
				id: { anyOf: [{ type: "integer" }, { type: "string" }] },
				mode: { enum: ["safe", "force"] },
			},
			required: ["id"],
		};

		expect(() =>
			assertTypeScriptContractCompatibility(
				"test.operation",
				"input",
				productInput,
				runtimeInput,
			),
		).not.toThrow();
		expect(() =>
			assertTypeScriptContractCompatibility(
				"test.operation",
				"input",
				productInput,
				{
					...runtimeInput,
					properties: {
						id: { type: "string" },
						mode: { enum: ["force"] },
					},
				},
			),
		).toThrow("primitive types drifted");

		const productOutput = {
			...productInput,
			schema: {
				type: "object",
				properties: {
					id: { type: "integer" },
					status: { enum: ["accepted", "queued"] },
				},
				required: ["id"],
			},
		} as const satisfies NormalizedContractSchema;
		expect(() =>
			assertTypeScriptContractCompatibility(
				"test.operation",
				"output",
				productOutput,
				{
					type: "object",
					properties: {
						id: { type: "integer" },
						status: { const: "accepted" },
					},
					required: ["id", "status"],
				},
			),
		).not.toThrow();
		expect(() =>
			assertTypeScriptContractCompatibility(
				"test.operation",
				"output",
				productOutput,
				{
					type: "object",
					properties: {
						id: { type: "integer" },
						status: { const: "rejected" },
					},
					required: ["id", "status"],
				},
			),
		).toThrow("literal values drifted");
		expect(() =>
			assertTypeScriptContractCompatibility(
				"test.operation",
				"output",
				{
					...productOutput,
					schema: {
						...productOutput.schema,
						additionalProperties: {},
					},
				},
				{
					type: "object",
					properties: {
						id: { type: "integer" },
						status: { const: "accepted" },
						new_runtime_field: { type: "string" },
					},
					required: ["id", "status"],
					additionalProperties: false,
				},
			),
		).not.toThrow();
		expect(() =>
			assertTypeScriptContractCompatibility(
				"test.operation",
				"output",
				{
					...productOutput,
					schema: {
						...productOutput.schema,
						additionalProperties: false,
					},
				},
				{
					type: "object",
					properties: {
						id: { type: "integer" },
						status: { const: "accepted" },
						new_runtime_field: { type: "string" },
					},
					required: ["id", "status"],
					additionalProperties: false,
				},
			),
		).toThrow("properties missing from TypeScript contract");

		const constrainedOutput = {
			...productInput,
			schema: {
				type: "object",
				properties: {
					checked_at: { type: "string", format: "date-time" },
					count: {
						type: "integer",
						minimum: 0,
						maximum: 10,
					},
					summary: {
						type: "object",
						properties: {
							ok: { type: "boolean" },
						},
						required: ["ok"],
						additionalProperties: false,
					},
				},
				required: ["checked_at", "count", "summary"],
				additionalProperties: false,
			},
		} as const satisfies NormalizedContractSchema;
		expect(() =>
			assertTypeScriptContractCompatibility(
				"test.operation",
				"output",
				constrainedOutput,
				{
					type: "object",
					properties: {
						checked_at: { type: "string" },
						count: {
							type: "integer",
							minimum: 0,
							maximum: 10,
						},
						summary: {
							type: "object",
							properties: {
								ok: { type: "boolean" },
							},
							required: ["ok"],
							additionalProperties: false,
						},
					},
					required: ["checked_at", "count", "summary"],
					additionalProperties: false,
				},
			),
		).toThrow("checked_at format drifted");
		expect(() =>
			assertTypeScriptContractCompatibility(
				"test.operation",
				"output",
				constrainedOutput,
				{
					type: "object",
					properties: {
						checked_at: {
							type: "string",
							format: "date-time",
						},
						count: {
							type: "integer",
							minimum: 0,
							maximum: 20,
						},
						summary: {
							type: "object",
							properties: {},
							required: [],
							additionalProperties: false,
						},
					},
					required: ["checked_at", "count", "summary"],
					additionalProperties: false,
				},
			),
		).toThrow("count maximum drifted");
		expect(() =>
			assertTypeScriptContractCompatibility(
				"test.operation",
				"output",
				constrainedOutput,
				{
					type: "object",
					properties: {
						checked_at: {
							type: "string",
							format: "date-time",
						},
						count: {
							type: "integer",
							minimum: 0,
							maximum: 10,
						},
						summary: {
							type: "object",
							properties: {},
							required: [],
							additionalProperties: false,
						},
					},
					required: ["checked_at", "count", "summary"],
					additionalProperties: false,
				},
			),
		).toThrow("summary required fields not guaranteed by runtime");

		const constrainedStringsAndArrays = {
			...productInput,
			schema: {
				type: "object",
				properties: {
					token: {
						type: "string",
						minLength: 1,
						maxLength: 8,
						pattern: "^[a-z]+$",
					},
					items: {
						type: "array",
						minItems: 1,
						maxItems: 3,
						items: { type: "string" },
					},
				},
				required: ["token", "items"],
				additionalProperties: false,
			},
		} as const satisfies NormalizedContractSchema;
		expect(() =>
			assertTypeScriptContractCompatibility(
				"test.string-output",
				"output",
				constrainedStringsAndArrays,
				{
					type: "object",
					properties: {
						token: { type: "string", maxLength: 8, pattern: "^[a-z]+$" },
						items: {
							type: "array",
							minItems: 1,
							maxItems: 3,
							items: { type: "string" },
						},
					},
					required: ["token", "items"],
					additionalProperties: false,
				},
			),
		).toThrow("token minLength drifted");
		for (const [runtimeToken, expectedMessage] of [
			[
				{
					type: "string",
					minLength: 1,
					maxLength: 9,
					pattern: "^[a-z]+$",
				},
				"token maxLength drifted",
			],
			[
				{
					type: "string",
					minLength: 1,
					maxLength: 8,
					pattern: "^[a-z0-9]+$",
				},
				"token pattern drifted",
			],
		] as const) {
			expect(() =>
				assertTypeScriptContractCompatibility(
					"test.string-output",
					"output",
					constrainedStringsAndArrays,
					{
						type: "object",
						properties: {
							token: runtimeToken,
							items: {
								type: "array",
								minItems: 1,
								maxItems: 3,
								items: { type: "string" },
							},
						},
						required: ["token", "items"],
						additionalProperties: false,
					},
				),
			).toThrow(expectedMessage);
		}
		expect(() =>
			assertTypeScriptContractCompatibility(
				"test.array-input",
				"input",
				{
					...constrainedStringsAndArrays,
					schema: {
						...constrainedStringsAndArrays.schema,
						properties: {
							...constrainedStringsAndArrays.schema.properties,
							items: {
								type: "array",
								items: { type: "string" },
							},
						},
					},
				},
				{
					type: "object",
					properties: {
						token: {
							type: "string",
							minLength: 1,
							maxLength: 8,
							pattern: "^[a-z]+$",
						},
						items: {
							type: "array",
							minItems: 1,
							items: { type: "string" },
						},
					},
					required: ["token", "items"],
					additionalProperties: false,
				},
			),
		).toThrow("items minItems drifted");
		expect(() =>
			assertTypeScriptContractCompatibility(
				"test.array-output",
				"output",
				constrainedStringsAndArrays,
				{
					type: "object",
					properties: {
						token: {
							type: "string",
							minLength: 1,
							maxLength: 8,
							pattern: "^[a-z]+$",
						},
						items: {
							type: "array",
							minItems: 1,
							maxItems: 4,
							items: { type: "string" },
						},
					},
					required: ["token", "items"],
					additionalProperties: false,
				},
			),
		).toThrow("items maxItems drifted");

		const circularProduct = {
			dialect: "openapi-3.1",
			stage: "normalized",
			source: "typescript",
			schema: { $ref: "#/components/schemas/Node" },
			components: {
				schemas: {
					Node: {
						anyOf: [
							{
								type: "object",
								properties: { value: { type: "string" } },
								additionalProperties: false,
							},
							{ $ref: "#/components/schemas/Node" },
						],
					},
				},
			},
		} as const satisfies NormalizedContractSchema;
		expect(() =>
			assertTypeScriptContractCompatibility(
				"test.circular",
				"output",
				circularProduct,
				{
					type: "object",
					properties: { value: { type: "string" } },
					additionalProperties: false,
				},
			),
		).not.toThrow();

		const malformedComponents = {
			...circularProduct,
			components: undefined,
		} as unknown as NormalizedContractSchema;
		expect(() =>
			assertTypeScriptContractCompatibility(
				"test.malformed-components",
				"output",
				malformedComponents,
				{
					type: "object",
					additionalProperties: false,
				},
			),
		).not.toThrow();
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

		const crossResourceOperation = defineOperationSpec({
			...campaignGetOperationSpec,
			effects: [{ kind: "read", resource: "subscriber" }],
		});
		expect(() =>
			defineEmailOperationsSpec({
				schemaVersion: "test",
				title: "Missing effect resource",
				description: "Reject unknown cross-resource effects",
				resources: [campaignResource],
				operations: [crossResourceOperation],
				events: [],
				playbooks: [],
			}),
		).toThrow("effect references unknown resource subscriber");

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
				operations: [
					{
						...campaignGetOperationSpec,
						agent: {
							...campaignGetOperationSpec.agent,
							prerequisites: [],
							verifyWith: [],
							related: [],
						},
					},
				],
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
				operations: [
					{
						...campaignGetOperationSpec,
						agent: {
							...campaignGetOperationSpec.agent,
							prerequisites: [],
							verifyWith: [],
							related: [],
						},
					},
				],
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
		expect(emailOperationsSpec.playbooks).toHaveLength(4);
		expect(emailOperationsSpec.playbooks).toContain(
			campaignSafeStartPlaybook,
		);
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
		const templatePromoteStep = emailOperationsSpec.playbooks
			.find((playbook) => playbook.id === "template.safe-promote")
			?.steps.find((step) => step.id === "promote");
		const templateCaptureStep = emailOperationsSpec.playbooks
			.find((playbook) => playbook.id === "template.safe-promote")
			?.steps.find((step) => step.id === "capture-remote");
		expect(templateCaptureStep).toMatchObject({
			operation: "ops.templates.registry-sync",
			input: [
				{
					parameter: "template_id",
					source: { kind: "playbook-input", name: "template_id" },
				},
			],
		});
		expect(templatePromoteStep?.input).toContainEqual({
			parameter: "expected_remote_hash",
			source: {
				kind: "step-output",
				stepId: "capture-remote",
				path: "templates.0.hash",
			},
		});
		const scheduleStep = emailOperationsSpec.playbooks
			.find((playbook) => playbook.id === "campaign.safe-schedule")
			?.steps.find((step) => step.id === "schedule");
		expect(scheduleStep?.input).toContainEqual({
			parameter: "expected_updated_at",
			source: {
				kind: "step-output",
				stepId: "preflight",
				path: "campaignUpdatedAt",
			},
		});
		const startStep = campaignSafeStartPlaybook.steps.find(
			(step) => step.id === "start",
		);
		expect(startStep?.input).toContainEqual({
			parameter: "expected_updated_at",
			source: {
				kind: "step-output",
				stepId: "preflight",
				path: "campaignUpdatedAt",
			},
		});
		const abTestRunStep = emailOperationsSpec.playbooks
			.find((playbook) => playbook.id === "abtest.safe-run")
			?.steps.find((step) => step.id === "run");
		expect(abTestRunStep?.input).toEqual(
			expect.arrayContaining([
				{
					parameter: "expected_status",
					source: {
						kind: "step-output",
						stepId: "inspect",
						path: "test.status",
					},
				},
				{
					parameter: "expected_updated_at",
					source: {
						kind: "step-output",
						stepId: "inspect",
						path: "test.updatedAt",
					},
				},
			]),
		);

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

	test("keeps runtime bridges experimental and rejects normalized contract drift", () => {
		const bridged = bridgedOperationSpecsById["lists.create"];
		expect(() =>
			defineOperationSpec({
				...bridged,
				stability: "stable",
			}),
		).toThrow(
			"Stable operation spec lists.create must use TypeScript-authored input and output contracts",
		);
		expect(() =>
			assertRuntimeOperationContracts(bridged, {
				input: { type: "object", properties: {} },
				output: bridged.contract.output.schema,
			}),
		).toThrow(
			"Runtime operation lists.create input contract drifted from its committed operation spec bridge",
		);

		expect(() =>
			assertRuntimeOperationContracts(bridged, {
				input: { type: "object", properties: {} },
				output: bridged.contract.output.schema,
			}),
		).toThrow(
			"Runtime operation lists.create input contract drifted from its committed operation spec bridge",
		);
	});
});
