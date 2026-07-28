import { z } from "zod";
import {
	type ComposedOperationCatalog,
	defineOperationCatalog,
	getOperationCatalogEntryById,
	getOperationCatalogEntryByMcpName,
	listOperationCatalogSummaries,
	type OperationCatalogSummary,
} from "./catalog";
import {
	bindControlCapabilitiesOperationSpec,
	bindControlPrimeOperationSpec,
	bindControlStatusOperationSpec,
	bindPlaybookGetOperationSpec,
	bindPlaybookListOperationSpec,
	bindSpecDescribeOperationSpec,
	bindSpecSearchOperationSpec,
	cloneSpecValue,
	emailOperationsSpec,
	type EmailOperationsSpec,
	type AnyOperationSpec,
	type OperationPlaybook,
} from "./specs";
import {
	defineOperation,
	normalizeOperationExecutionError,
	parseOperationInput,
	parseOperationOutput,
} from "./operation";

const readOnlyClosedWorldSafety = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
} as const;

const readOnlyOpenWorldSafety = {
	...readOnlyClosedWorldSafety,
	openWorldHint: true,
} as const;

const operationDiscoverySafetySchema = z.object({
	read_only: z.boolean(),
	destructive: z.boolean(),
	idempotent: z.boolean(),
	confirmation_required: z.boolean(),
	audit_required: z.boolean(),
	dry_run_supported: z.boolean(),
});

const operationSearchResultSchema = z.object({
	family: z.string().min(1),
	id: z.string().min(1),
	mcp_name: z.string().min(1),
	title: z.string().min(1),
	description: z.string().min(1),
	score: z.number().int().nonnegative(),
	coverage: z.enum(["described", "migration"]),
	resource: z.string().min(1).optional(),
	verb: z.string().min(1).optional(),
	stability: z.string().min(1).optional(),
	safety: operationDiscoverySafetySchema,
	use_when: z.array(z.string()),
	avoid_when: z.array(z.string()),
});

const specSearchInputSchema = z.object({
	query: z.string().trim().min(1),
	family: z.string().trim().min(1).optional(),
	resource: z.string().trim().min(1).optional(),
	verb: z.string().trim().min(1).optional(),
	limit: z.coerce.number().int().min(1).max(100).default(20),
});

const specSearchOutputSchema = z.object({
	query: z.string().min(1),
	total: z.number().int().nonnegative(),
	results: z.array(operationSearchResultSchema),
});

const specDescribeInputSchema = z.object({
	operation: z.string().trim().min(1),
});

const operationDescriptionSchema = operationSearchResultSchema
	.omit({ score: true })
	.extend({
		family_title: z.string().min(1),
		input_schema: z.record(z.string(), z.unknown()),
		output_schema: z.record(z.string(), z.unknown()),
		spec: z.record(z.string(), z.unknown()).optional(),
		migration: z.record(z.string(), z.unknown()).optional(),
	});

const specDescribeOutputSchema = z.object({
	operation: operationDescriptionSchema,
});

const emptyInputSchema = z.object({});

const playbookSummarySchema = z.object({
	id: z.string().min(1),
	title: z.string().min(1),
	goal: z.string().min(1),
	step_count: z.number().int().positive(),
	recovery_operation: z.string().min(1),
});

const playbookListOutputSchema = z.object({
	playbooks: z.array(playbookSummarySchema),
});

const playbookGetInputSchema = z.object({
	id: z.string().trim().min(1),
});

const playbookOperationReferenceSchema = z.object({
	step_id: z.string().min(1),
	operation: operationSearchResultSchema,
	approval: z.enum(["none", "human"]),
});

const playbookGetOutputSchema = z.object({
	playbook: z.record(z.string(), z.unknown()),
	operations: z.array(playbookOperationReferenceSchema),
});

const capabilityFamilySchema = z.object({
	id: z.string().min(1),
	title: z.string().min(1),
	operations: z.number().int().positive(),
	described: z.number().int().nonnegative(),
});

const controlCapabilitiesOutputSchema = z.object({
	schema_version: z.string().min(1),
	resources: z.number().int().nonnegative(),
	playbooks: z.number().int().nonnegative(),
	operations: z.number().int().nonnegative(),
	described_operations: z.number().int().nonnegative(),
	migration_operations: z.number().int().nonnegative(),
	spec_coverage_complete: z.boolean(),
	families: z.array(capabilityFamilySchema),
});

const controlPrimeInputSchema = z.object({
	goal: z.string().trim().min(1).optional(),
	limit: z.coerce.number().int().min(1).max(20).default(8),
});

const controlPrimeOutputSchema = z.object({
	goal: z.string().min(1).optional(),
	capabilities: controlCapabilitiesOutputSchema,
	recommended_operations: z.array(operationSearchResultSchema),
	recommended_playbooks: z.array(playbookSummarySchema),
	guidance: z.array(z.string()),
});

const controlStatusInputSchema = emptyInputSchema;

const controlStatusOutputSchema = z.object({
	surface: z.enum(["cli", "mcp"]),
	version: z.string().min(1),
	runtime: z.record(z.string(), z.string()),
	target: z
		.object({
			url: z.string().min(1),
			auth: z.enum(["token", "none"]),
		})
		.optional(),
	listmonk: z.object({
		configured: z.boolean(),
		reachable: z.boolean(),
		health_error: z.string().optional(),
	}),
	specs: z.object({
		schema_version: z.string().min(1),
		operations: z.number().int().nonnegative(),
		described: z.number().int().nonnegative(),
		migrations: z.number().int().nonnegative(),
		complete: z.boolean(),
	}),
	readiness: z.object({
		catalog: z.boolean(),
		specs: z.boolean(),
		listmonk: z.boolean(),
	}),
});

export interface DiscoveryOperationContext {
	catalog: ComposedOperationCatalog;
	spec?: EmailOperationsSpec | undefined;
}

export interface ControlStatusOperationContext extends DiscoveryOperationContext {
	surface: "cli" | "mcp";
	version: string;
	runtime: Readonly<Record<string, string>>;
	target?:
		| {
				url: string;
				auth: "token" | "none";
		  }
		| undefined;
	probeListmonk?: (() => Promise<boolean>) | undefined;
}

type OperationSearchResult = z.output<typeof operationSearchResultSchema>;

function operationSpec(context: DiscoveryOperationContext): EmailOperationsSpec {
	return context.spec ?? emailOperationsSpec;
}

function toOperationSearchResult(
	summary: OperationCatalogSummary,
	score: number,
): OperationSearchResult {
	const spec = summary.spec;
	return {
		family: summary.family,
		id: summary.id,
		mcp_name: summary.mcpName,
		title: summary.title,
		description: summary.description,
		score,
		coverage: spec === undefined ? "migration" : "described",
		...(spec === undefined
			? {}
			: {
					resource: spec.resource,
					verb: spec.verb,
					stability: spec.stability,
				}),
		safety: {
			read_only: summary.safety.readOnlyHint,
			destructive: summary.safety.destructiveHint,
			idempotent: summary.safety.idempotentHint,
			confirmation_required: summary.execution.confirmationRequired,
			audit_required: summary.execution.auditRequired,
			dry_run_supported: summary.execution.dryRunSupported,
		},
		use_when: spec?.agent.useWhen.slice() ?? [],
		avoid_when: spec?.agent.avoidWhen.slice() ?? [],
	};
}

function specRetryIsIdempotent(spec: AnyOperationSpec): boolean {
	if (spec.retry.kind === "safe") return true;
	if (spec.retry.kind === "unsafe") return false;
	if (spec.retry.kind === "reconcile") return spec.retry.idempotent;
	return spec.retry.cases.every(({ semantics }) => {
		if (semantics.kind === "safe") return true;
		if (semantics.kind === "unsafe") return false;
		return semantics.idempotent;
	});
}

function toSpecOnlySearchResult(
	spec: AnyOperationSpec,
	score: number,
): OperationSearchResult {
	return {
		family: spec.id.split(".")[0] ?? spec.resource,
		id: spec.id,
		mcp_name: spec.projection.mcpName,
		title: spec.title,
		description: spec.description,
		score,
		coverage: "described",
		resource: spec.resource,
		verb: spec.verb,
		stability: spec.stability,
		safety: {
			read_only: spec.effects.every(({ kind }) => kind === "read"),
			destructive: spec.policy.confirmation === "required",
			idempotent: specRetryIsIdempotent(spec),
			confirmation_required: spec.policy.confirmation === "required",
			audit_required: spec.policy.audit === "required",
			dry_run_supported: spec.policy.dryRun,
		},
		use_when: spec.agent.useWhen.slice(),
		avoid_when: spec.agent.avoidWhen.slice(),
	};
}

function searchableText(summary: OperationCatalogSummary): string {
	return [
		summary.family,
		summary.familyTitle,
		summary.id,
		summary.mcpName,
		summary.title,
		summary.description,
		summary.spec?.resource,
		summary.spec?.verb,
		...(summary.spec?.agent.useWhen ?? []),
		...(summary.spec?.agent.avoidWhen ?? []),
	].join(" ").toLowerCase();
}

function scoreOperation(summary: OperationCatalogSummary, query: string): number {
	const normalized = query.trim().toLowerCase();
	if (normalized === "*") {
		return 1;
	}
	const tokens = normalized.split(/[^a-z0-9._-]+/u).filter(Boolean);
	if (tokens.length === 0) {
		return 0;
	}

	const id = summary.id.toLowerCase();
	const mcpName = summary.mcpName.toLowerCase();
	const title = summary.title.toLowerCase();
	const description = summary.description.toLowerCase();
	const all = searchableText(summary);
	// Exact identifiers rank above titles and free-text matches. Every query
	// token must be present so broad intent searches stay deterministic and
	// avoid returning unrelated operations.
	let score = 0;
	if (id === normalized || mcpName === normalized) score += 1_000;
	if (title === normalized) score += 500;
	if (all.includes(normalized)) score += 100;
	for (const token of tokens) {
		if (!all.includes(token)) {
			return 0;
		}
		if (id.includes(token) || mcpName.includes(token)) score += 40;
		if (title.includes(token)) score += 25;
		if (description.includes(token)) score += 10;
		score += 1;
	}
	return score;
}

export async function searchOperationSpecs(
	context: DiscoveryOperationContext,
	input: z.output<typeof specSearchInputSchema>,
): Promise<z.output<typeof specSearchOutputSchema>> {
	const matches = listOperationCatalogSummaries(context.catalog)
		.filter((summary) => {
			const spec = summary.spec;
			return (
				(input.family === undefined || summary.family === input.family) &&
				(input.resource === undefined || spec?.resource === input.resource) &&
				(input.verb === undefined || spec?.verb === input.verb)
			);
		})
		.map((summary) => ({
			summary,
			score: scoreOperation(summary, input.query),
		}))
		.filter(({ score }) => score > 0)
		.sort(
			(left, right) =>
				right.score - left.score ||
				left.summary.id.localeCompare(right.summary.id),
		);

	return {
		query: input.query,
		total: matches.length,
		results: matches
			.slice(0, input.limit)
			.map(({ summary, score }) => toOperationSearchResult(summary, score)),
	};
}

export async function describeOperationSpec(
	context: DiscoveryOperationContext,
	input: z.output<typeof specDescribeInputSchema>,
): Promise<z.output<typeof specDescribeOutputSchema>> {
	const entry =
		getOperationCatalogEntryById(context.catalog, input.operation) ??
		getOperationCatalogEntryByMcpName(context.catalog, input.operation);
	if (entry === undefined) {
		throw new Error(`Unknown operation or MCP tool: ${input.operation}`);
	}
	const summary = listOperationCatalogSummaries(
		context.catalog,
		entry.family,
	).find(({ id }) => id === entry.operation.id);
	if (summary === undefined) {
		throw new Error(`Unable to describe operation: ${entry.operation.id}`);
	}
	const { score: _searchScore, ...base } = toOperationSearchResult(
		summary,
		1_000,
	);
	return {
		operation: {
			...base,
			family_title: summary.familyTitle,
			input_schema: summary.inputSchema,
			output_schema: summary.outputSchema,
			...(summary.spec === undefined
				? {}
				: {
						spec: cloneSpecValue(summary.spec) as unknown as Record<
							string,
							unknown
						>,
					}),
			...(summary.specMigration === undefined
				? {}
				: {
						migration: cloneSpecValue(
							summary.specMigration,
						) as unknown as Record<string, unknown>,
					}),
		},
	};
}

function summarizePlaybook(playbook: OperationPlaybook) {
	return {
		id: playbook.id,
		title: playbook.title,
		goal: playbook.goal,
		step_count: playbook.steps.length,
		recovery_operation: playbook.recoveryOperation,
	};
}

export async function listOperationPlaybooks(
	context: DiscoveryOperationContext,
): Promise<z.output<typeof playbookListOutputSchema>> {
	return {
		playbooks: operationSpec(context).playbooks.map(summarizePlaybook),
	};
}

export async function getOperationPlaybook(
	context: DiscoveryOperationContext,
	input: z.output<typeof playbookGetInputSchema>,
): Promise<z.output<typeof playbookGetOutputSchema>> {
	const playbook = operationSpec(context).playbooks.find(
		(candidate) => candidate.id === input.id,
	);
	if (playbook === undefined) {
		throw new Error(`Unknown operation playbook: ${input.id}`);
	}
	const summaries = new Map(
		listOperationCatalogSummaries(context.catalog).map((summary) => [
			summary.id,
			summary,
		]),
	);
	return {
		playbook: cloneSpecValue(playbook) as unknown as Record<string, unknown>,
		operations: playbook.steps.map((step) => {
			const summary = summaries.get(step.operation);
			if (summary === undefined) {
				const spec = operationSpec(context).operations.find(
					(operation) => operation.id === step.operation,
				);
				if (spec === undefined) {
					throw new Error(
						`Playbook ${playbook.id} references unavailable operation ${step.operation}`,
					);
				}
				return {
					step_id: step.id,
					operation: toSpecOnlySearchResult(spec, 1_000),
					approval: step.approval,
				};
			}
			return {
				step_id: step.id,
				operation: toOperationSearchResult(summary, 1_000),
				approval: step.approval,
			};
		}),
	};
}

export async function getControlCapabilities(
	context: DiscoveryOperationContext,
): Promise<z.output<typeof controlCapabilitiesOutputSchema>> {
	const summaries = listOperationCatalogSummaries(context.catalog);
	const described = summaries.filter(
		(summary) => summary.spec !== undefined,
	).length;
	const spec = operationSpec(context);
	return {
		schema_version: spec.schemaVersion,
		resources: spec.resources.length,
		playbooks: spec.playbooks.length,
		operations: summaries.length,
		described_operations: described,
		migration_operations: summaries.length - described,
		spec_coverage_complete: described === summaries.length,
		families: context.catalog.catalogs.map((catalog) => ({
			id: catalog.id,
			title: catalog.title,
			operations: catalog.operations.length,
			described: catalog.operations.filter(
				(operation) => operation.spec !== undefined,
			).length,
		})),
	};
}

export async function primeOperationsAgent(
	context: DiscoveryOperationContext,
	input: z.output<typeof controlPrimeInputSchema>,
): Promise<z.output<typeof controlPrimeOutputSchema>> {
	const capabilities = await getControlCapabilities(context);
	const recommendedOperations =
		input.goal === undefined
			? listOperationCatalogSummaries(context.catalog)
					.filter(({ id }) =>
						[
							"control.status",
							"specs.search",
							"playbooks.list",
						].includes(id),
					)
					.slice(0, input.limit)
					.map((summary) => toOperationSearchResult(summary, 1))
			: (
					await searchOperationSpecs(context, {
						query: input.goal,
						limit: input.limit,
					})
				).results;
	const normalizedGoal = input.goal?.toLowerCase();
	const recommendedPlaybooks = operationSpec(context).playbooks
		.filter(
			(playbook) => {
				if (normalizedGoal === undefined) return true;
				const searchable = `${playbook.title} ${playbook.goal}`.toLowerCase();
				return normalizedGoal
					.split(/\s+/u)
					.some((token) => searchable.includes(token));
			},
		)
		.slice(0, input.limit)
		.map(summarizePlaybook);

	return {
		...(input.goal === undefined ? {} : { goal: input.goal }),
		capabilities,
		recommended_operations: recommendedOperations,
		recommended_playbooks: recommendedPlaybooks,
		guidance: [
			"Run control.status before operations that depend on live Listmonk state.",
			"Inspect specs.describe before invoking a mutating or delivery operation.",
			"Prefer a typed playbook when one matches the goal.",
			"Respect confirmation, dry-run, retry, and verification guidance from the operation spec.",
		],
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function getControlStatus(
	context: ControlStatusOperationContext,
): Promise<z.output<typeof controlStatusOutputSchema>> {
	const capabilities = await getControlCapabilities(context);
	let reachable = false;
	let healthError: string | undefined;
	if (context.probeListmonk !== undefined) {
		try {
			reachable = await context.probeListmonk();
		} catch (error) {
			healthError = errorMessage(error);
		}
	}

	return {
		surface: context.surface,
		version: context.version,
		runtime: { ...context.runtime },
		...(context.target === undefined ? {} : { target: { ...context.target } }),
		listmonk: {
			configured: context.probeListmonk !== undefined,
			reachable,
			...(healthError === undefined ? {} : { health_error: healthError }),
		},
		specs: {
			schema_version: capabilities.schema_version,
			operations: capabilities.operations,
			described: capabilities.described_operations,
			migrations: capabilities.migration_operations,
			complete: capabilities.spec_coverage_complete,
		},
		readiness: {
			catalog: capabilities.operations > 0,
			specs: capabilities.described_operations > 0,
			listmonk: reachable,
		},
	};
}

export const specSearchOperation = defineOperation({
	id: "specs.search",
	title: "Search operation specs",
	description:
		"Search shared Listmonk operation contracts and agent guidance by intent, family, resource, or verb.",
	inputSchema: specSearchInputSchema,
	outputSchema: specSearchOutputSchema,
	safety: readOnlyClosedWorldSafety,
	mcp: { name: "listmonk_schema_search" },
	spec: bindSpecSearchOperationSpec(),
	execute: searchOperationSpecs,
});

export const specDescribeOperation = defineOperation({
	id: "specs.describe",
	title: "Describe operation spec",
	description:
		"Describe one shared operation by operation ID or MCP tool name, including safety, retry, and agent guidance.",
	inputSchema: specDescribeInputSchema,
	outputSchema: specDescribeOutputSchema,
	safety: readOnlyClosedWorldSafety,
	mcp: { name: "listmonk_schema_describe" },
	spec: bindSpecDescribeOperationSpec(),
	execute: describeOperationSpec,
});

export const playbookListOperation = defineOperation({
	id: "playbooks.list",
	title: "List operation playbooks",
	description:
		"List typed operation playbooks that encode safe multi-step Listmonk workflows.",
	inputSchema: emptyInputSchema,
	outputSchema: playbookListOutputSchema,
	safety: readOnlyClosedWorldSafety,
	mcp: { name: "listmonk_list_playbooks" },
	spec: bindPlaybookListOperationSpec(),
	execute: listOperationPlaybooks,
});

export const playbookGetOperation = defineOperation({
	id: "playbooks.get",
	title: "Get operation playbook",
	description:
		"Get a typed operation playbook and the operation contracts referenced by its steps.",
	inputSchema: playbookGetInputSchema,
	outputSchema: playbookGetOutputSchema,
	safety: readOnlyClosedWorldSafety,
	mcp: { name: "listmonk_playbook_get" },
	spec: bindPlaybookGetOperationSpec(),
	execute: getOperationPlaybook,
});

export const controlCapabilitiesOperation = defineOperation({
	id: "control.capabilities",
	title: "Get control-plane capabilities",
	description:
		"Summarize shared operation families, typed specification coverage, resources, and playbooks.",
	inputSchema: emptyInputSchema,
	outputSchema: controlCapabilitiesOutputSchema,
	safety: readOnlyClosedWorldSafety,
	mcp: { name: "listmonk_capabilities" },
	spec: bindControlCapabilitiesOperationSpec(),
	execute: getControlCapabilities,
});

export const controlPrimeOperation = defineOperation({
	id: "control.prime",
	title: "Prime an operations agent",
	description:
		"Return installation capabilities and goal-oriented operation and playbook recommendations for an AI agent.",
	inputSchema: controlPrimeInputSchema,
	outputSchema: controlPrimeOutputSchema,
	safety: readOnlyClosedWorldSafety,
	mcp: { name: "listmonk_prime" },
	spec: bindControlPrimeOperationSpec(),
	execute: primeOperationsAgent,
});

export const controlStatusOperation = defineOperation({
	id: "control.status",
	title: "Get control-plane status",
	description:
		"Check catalog integrity, typed specification coverage, runtime identity, and live Listmonk connectivity.",
	inputSchema: controlStatusInputSchema,
	outputSchema: controlStatusOutputSchema,
	safety: readOnlyOpenWorldSafety,
	mcp: { name: "listmonk_status" },
	spec: bindControlStatusOperationSpec(),
	execute: getControlStatus,
});

export async function invokeSpecSearchOperation(
	context: DiscoveryOperationContext,
	input: unknown,
) {
	const parsedInput = parseOperationInput(
		specSearchOperation.inputSchema,
		input,
	);
	let output: z.output<typeof specSearchOutputSchema>;
	try {
		output = await searchOperationSpecs(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(specSearchOperation.id, error);
	}
	return parseOperationOutput(
		specSearchOperation.id,
		specSearchOperation.outputSchema,
		output,
	);
}

export async function invokeSpecDescribeOperation(
	context: DiscoveryOperationContext,
	input: unknown,
) {
	const parsedInput = parseOperationInput(
		specDescribeOperation.inputSchema,
		input,
	);
	let output: z.output<typeof specDescribeOutputSchema>;
	try {
		output = await describeOperationSpec(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(specDescribeOperation.id, error);
	}
	return parseOperationOutput(
		specDescribeOperation.id,
		specDescribeOperation.outputSchema,
		output,
	);
}

export async function invokePlaybookListOperation(
	context: DiscoveryOperationContext,
	input: unknown,
) {
	const parsedInput = parseOperationInput(
		playbookListOperation.inputSchema,
		input,
	);
	void parsedInput;
	let output: z.output<typeof playbookListOutputSchema>;
	try {
		output = await listOperationPlaybooks(context);
	} catch (error) {
		throw normalizeOperationExecutionError(playbookListOperation.id, error);
	}
	return parseOperationOutput(
		playbookListOperation.id,
		playbookListOperation.outputSchema,
		output,
	);
}

export async function invokePlaybookGetOperation(
	context: DiscoveryOperationContext,
	input: unknown,
) {
	const parsedInput = parseOperationInput(
		playbookGetOperation.inputSchema,
		input,
	);
	let output: z.output<typeof playbookGetOutputSchema>;
	try {
		output = await getOperationPlaybook(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(playbookGetOperation.id, error);
	}
	return parseOperationOutput(
		playbookGetOperation.id,
		playbookGetOperation.outputSchema,
		output,
	);
}

export async function invokeControlCapabilitiesOperation(
	context: DiscoveryOperationContext,
	input: unknown,
) {
	const parsedInput = parseOperationInput(
		controlCapabilitiesOperation.inputSchema,
		input,
	);
	void parsedInput;
	let output: z.output<typeof controlCapabilitiesOutputSchema>;
	try {
		output = await getControlCapabilities(context);
	} catch (error) {
		throw normalizeOperationExecutionError(
			controlCapabilitiesOperation.id,
			error,
		);
	}
	return parseOperationOutput(
		controlCapabilitiesOperation.id,
		controlCapabilitiesOperation.outputSchema,
		output,
	);
}

export async function invokeControlPrimeOperation(
	context: DiscoveryOperationContext,
	input: unknown,
) {
	const parsedInput = parseOperationInput(
		controlPrimeOperation.inputSchema,
		input,
	);
	let output: z.output<typeof controlPrimeOutputSchema>;
	try {
		output = await primeOperationsAgent(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(controlPrimeOperation.id, error);
	}
	return parseOperationOutput(
		controlPrimeOperation.id,
		controlPrimeOperation.outputSchema,
		output,
	);
}

export async function invokeControlStatusOperation(
	context: ControlStatusOperationContext,
	input: unknown,
) {
	const parsedInput = parseOperationInput(
		controlStatusOperation.inputSchema,
		input,
	);
	void parsedInput;
	let output: z.output<typeof controlStatusOutputSchema>;
	try {
		output = await getControlStatus(context);
	} catch (error) {
		throw normalizeOperationExecutionError(controlStatusOperation.id, error);
	}
	return parseOperationOutput(
		controlStatusOperation.id,
		controlStatusOperation.outputSchema,
		output,
	);
}

export const discoveryOperations = [
	specSearchOperation,
	specDescribeOperation,
	playbookListOperation,
	playbookGetOperation,
	controlCapabilitiesOperation,
	controlPrimeOperation,
	controlStatusOperation,
] as const;

export type DiscoveryOperation = (typeof discoveryOperations)[number];

const discoveryOperationsByMcpName = new Map<string, DiscoveryOperation>(
	discoveryOperations.map((operation) => [operation.mcp.name, operation]),
);

export function getDiscoveryOperationByMcpName(
	name: string,
): DiscoveryOperation | undefined {
	return discoveryOperationsByMcpName.get(name);
}

export async function invokeDiscoveryOperationByMcpName(
	context: ControlStatusOperationContext,
	name: string,
	input: unknown,
): Promise<unknown> {
	switch (name) {
		case specSearchOperation.mcp.name:
			return invokeSpecSearchOperation(context, input);
		case specDescribeOperation.mcp.name:
			return invokeSpecDescribeOperation(context, input);
		case playbookListOperation.mcp.name:
			return invokePlaybookListOperation(context, input);
		case playbookGetOperation.mcp.name:
			return invokePlaybookGetOperation(context, input);
		case controlCapabilitiesOperation.mcp.name:
			return invokeControlCapabilitiesOperation(context, input);
		case controlPrimeOperation.mcp.name:
			return invokeControlPrimeOperation(context, input);
		case controlStatusOperation.mcp.name:
			return invokeControlStatusOperation(context, input);
		default:
			return undefined;
	}
}

export const discoveryOperationCatalog = defineOperationCatalog({
	id: "discovery",
	title: "Agent discovery and readiness",
	operations: discoveryOperations,
	specMigrationExemptions: [],
});
