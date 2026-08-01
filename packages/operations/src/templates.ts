import type { ListmonkClient, Template } from "@listmonk-ops/openapi";
import {
	bindBridgedOperationSpec,
	bindTemplatesGetOperationSpec,
	bindTemplatesListOperationSpec,
} from "./specs";
import { z } from "zod";
import {
	createResourceSafety,
	deleteResourceSafety,
	jsonResourceValue,
	normalizeResourceList,
	optionalBooleanSchema,
	readResourceSafety,
	resourceIdSchema,
	toResourceErrorMessage,
	unwrapResourceResponse,
	updateResourceSafety,
} from "./resource-helpers";
import { defineOperationCatalog } from "./catalog";
import {
	defineOperation,
	normalizeOperationExecutionError,
	parseOperationInput,
	parseOperationOutput,
} from "./operation";

export interface TemplateOperationContext {
	client: Pick<ListmonkClient, "template">;
}

const templateTypeSchema = z.enum(["campaign", "campaign_visual", "tx"]);

const templateSchema = z.looseObject({
	id: z.number().int().positive().optional(),
	created_at: z.string().optional(),
	updated_at: z.string().optional(),
	name: z.string().optional(),
	body: z.string().optional(),
	body_source: z.string().nullable().optional(),
	subject: z.string().optional(),
	type: z.string().optional(),
	is_default: z.boolean().optional(),
});

const templateListOutputSchema = z.object({
	results: z.array(templateSchema),
	total: z.number(),
	per_page: z.number(),
	page: z.number(),
});

const templateIdInputSchema = z.object({
	id: resourceIdSchema,
});

const templateListInputSchema = z.object({
	page: z.coerce.number().int().positive().default(1),
	per_page: z.coerce.number().int().positive().default(20),
	no_body: optionalBooleanSchema.optional(),
});

const createTemplateInputSchema = z.object({
	name: z.string().trim().min(1),
	type: templateTypeSchema.default("campaign"),
	subject: z.string().optional().default(""),
	body_source: z.string().optional(),
	body: z.string().min(1),
});

const templateManifestSchema = z
	.object({
		schema_version: z.literal(1),
		templates: z.array(createTemplateInputSchema).min(1),
	})
	.superRefine((manifest, context) => {
		const names = new Set<string>();
		for (const [index, template] of manifest.templates.entries()) {
			if (names.has(template.name)) {
				context.addIssue({
					code: "custom",
					message: `Template manifest contains duplicate name ${JSON.stringify(template.name)}`,
					path: ["templates", index, "name"],
				});
			}
			names.add(template.name);
		}
	});

export type TemplateDesiredState = z.input<typeof createTemplateInputSchema>;
export type TemplateManifest = z.input<typeof templateManifestSchema>;

export interface TemplateReconcileOptions {
	/** Apply the planned mutation. Omit or set false for a read-only plan. */
	apply?: boolean;
}

export interface TemplateReconcileResult {
	name: string;
	action: "create" | "update" | "unchanged";
	applied: boolean;
	template?: z.output<typeof templateSchema>;
}

export interface TemplateManifestReconcileResult {
	schema_version: 1;
	apply: boolean;
	results: TemplateReconcileResult[];
}

export class TemplateManifestApplyError extends Error {
	public readonly failedTemplate: string;
	public readonly appliedResults: readonly TemplateReconcileResult[];

	public constructor(
		failedTemplate: string,
		appliedResults: readonly TemplateReconcileResult[],
		cause: unknown,
	) {
		super(
			`Template manifest apply failed at ${JSON.stringify(failedTemplate)} after ${appliedResults.length} completed entries`,
			{ cause },
		);
		this.name = "TemplateManifestApplyError";
		this.failedTemplate = failedTemplate;
		this.appliedResults = [...appliedResults];
	}
}

const updateTemplateInputSchema = z
	.object({
		id: resourceIdSchema,
		name: z.string().trim().min(1).optional(),
		type: templateTypeSchema.optional(),
		subject: z.string().optional(),
		body_source: z.string().optional(),
		body: z.string().min(1).optional(),
	})
	.refine(
		({ id: _id, ...changes }) =>
			Object.values(changes).some((value) => value !== undefined),
		{
			message: "At least one template field must be provided for update",
			path: ["id"],
		},
	);

const deleteTemplateOutputSchema = z.object({
	id: z.number().int().positive(),
	deleted: z.boolean(),
});

const setDefaultTemplateOutputSchema = z.object({
	id: z.number().int().positive(),
	set_default: z.literal(true),
});

export type TemplateListPage = z.output<typeof templateListOutputSchema>;

type TemplateCreateBody = NonNullable<
	Parameters<ListmonkClient["template"]["create"]>[0]["body"]
>;
type TemplateUpdateBody = NonNullable<
	Parameters<ListmonkClient["template"]["update"]>[0]["body"]
>;
type TemplateListOptions = Parameters<
	ListmonkClient["template"]["list"]
>[0];

function asTemplate(value: Template): z.output<typeof templateSchema> {
	return value as z.output<typeof templateSchema>;
}

function isPositiveSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export async function listTemplates(
	{ client }: TemplateOperationContext,
	input: z.output<typeof templateListInputSchema>,
): Promise<TemplateListPage> {
	const response = await client.template.list(
		input.no_body === undefined
			? undefined
			: { query: { no_body: input.no_body } },
	);
	const data = unwrapResourceResponse(response, "Failed to fetch templates");
	const normalized = normalizeResourceList(data, {
		page: 1,
		per_page: data.results?.length ?? 0,
	});
	const start = (input.page - 1) * input.per_page;
	return {
		results: normalized.results.slice(start, start + input.per_page),
		total: normalized.total,
		per_page: input.per_page,
		page: input.page,
	};
}

export async function getTemplate(
	{ client }: TemplateOperationContext,
	input: z.output<typeof templateIdInputSchema>,
): Promise<z.output<typeof templateSchema>> {
	const response = await client.template.getById({ path: { id: input.id } });
	return asTemplate(
		unwrapResourceResponse(response, "Failed to fetch template"),
	);
}

async function findCreatedTemplate(
	client: Pick<ListmonkClient, "template">,
	name: string,
): Promise<Template | undefined> {
	const pageSize = 100;
	const firstResponse = await client.template.list();
	const firstPage = unwrapResourceResponse(
		firstResponse,
		"Failed to resolve created template",
	);
	const firstMatch = firstPage.results?.find(
		(template) => template.name === name,
	);
	if (firstMatch) return firstMatch;

	const pageCount = Math.max(
		1,
		Math.ceil(
			(firstPage.total ?? 0) / Math.max(firstPage.per_page ?? pageSize, 1),
		),
	);
	for (let page = 2; page <= pageCount; page += 1) {
		const response = await client.template.list({
			query: { page, per_page: pageSize },
		} as TemplateListOptions);
		const pageData = unwrapResourceResponse(
			response,
			"Failed to resolve created template",
		);
		const match = pageData.results?.find((template) => template.name === name);
		if (match) return match;
	}

	return undefined;
}

export async function createTemplate(
	{ client }: TemplateOperationContext,
	input: z.output<typeof createTemplateInputSchema>,
): Promise<z.output<typeof templateSchema>> {
	const response = await client.template.create({
		body: input as TemplateCreateBody,
	});
	if ("error" in response && response.error !== undefined) {
		throw new Error(
			`Failed to create template: ${toResourceErrorMessage(response.error)}`,
		);
	}
	if (response.data !== undefined) return asTemplate(response.data);

	const created = await findCreatedTemplate(client, input.name);
	if (!created) {
		throw new Error(
			"Template was created but the created record could not be resolved",
		);
	}
	return asTemplate(created);
}

export async function updateTemplate(
	{ client }: TemplateOperationContext,
	input: z.output<typeof updateTemplateInputSchema>,
): Promise<z.output<typeof templateSchema>> {
	const currentResponse = await client.template.getById({
		path: { id: input.id },
	});
	const current = unwrapResourceResponse(
		currentResponse,
		"Failed to load current template",
	);
	const type = input.type ??
		(current.type === "campaign_visual" || current.type === "tx"
			? current.type
			: "campaign");
	const body = {
		name: input.name ?? current.name ?? "",
		type,
		subject: input.subject ?? current.subject ?? "",
		body: input.body ?? current.body ?? "",
		body_source:
			input.body_source !== undefined ? input.body_source : current.body_source,
	};
	if (!body.name || !body.body) {
		throw new Error("Template update requires name and body after merge");
	}

	const response = await client.template.update({
		path: { id: input.id },
		body: body as TemplateUpdateBody,
	});
	return asTemplate(
		unwrapResourceResponse(response, "Failed to update template"),
	);
}

async function planTemplateFromCandidates(
	{ client }: TemplateOperationContext,
	desired: z.output<typeof createTemplateInputSchema>,
	candidates: readonly Template[],
): Promise<TemplateReconcileResult> {
	const matches = candidates.filter(
		(template) => template.name === desired.name,
	);
	if (matches.length > 1) {
		throw new Error(
			`Template reconcile is ambiguous: ${matches.length} templates are named ${JSON.stringify(desired.name)}`,
		);
	}
	const existing = matches[0];
	if (existing === undefined) {
		return {
			name: desired.name,
			action: "create",
			applied: false,
		};
	}
	const existingId = existing.id;
	if (!isPositiveSafeInteger(existingId)) {
		throw new Error(
			`Template reconcile found ${JSON.stringify(desired.name)} with invalid ID ${JSON.stringify(existingId)}`,
		);
	}
	const current = unwrapResourceResponse(
		await client.template.getById({ path: { id: existingId } }),
		"Failed to load current template for reconcile",
	);
	if (templateMatchesDesiredState(current, desired)) {
		return {
			name: desired.name,
			action: "unchanged",
			applied: false,
			template: asTemplate(current),
		};
	}
	return {
		name: desired.name,
		action: "update",
		applied: false,
		template: asTemplate(current),
	};
}

/** Plan one exact-name template reconciliation without mutating Listmonk. */
export async function planTemplateReconcile(
	context: TemplateOperationContext,
	input: TemplateDesiredState,
): Promise<TemplateReconcileResult> {
	const desired = createTemplateInputSchema.parse(input);
	const candidates = await listTemplatesForReconcile(context.client);
	return planTemplateFromCandidates(context, desired, candidates);
}

async function applyTemplateReconcilePlan(
	context: TemplateOperationContext,
	desired: z.output<typeof createTemplateInputSchema>,
	plan: TemplateReconcileResult,
): Promise<TemplateReconcileResult> {
	if (plan.action === "unchanged") return plan;

	if (plan.action === "create") {
		return {
			...plan,
			applied: true,
			template: await createTemplate(context, desired),
		};
	}

	const existingId = plan.template?.id;
	if (!isPositiveSafeInteger(existingId)) {
		throw new Error(
			`Template update plan for ${JSON.stringify(desired.name)} is missing a positive template ID`,
		);
	}
	return {
		...plan,
		applied: true,
		template: await updateTemplate(context, {
			id: existingId,
			name: desired.name,
			type: desired.type,
			subject: desired.subject,
			body_source: desired.body_source,
			body: desired.body,
		}),
	};
}

/** Reconcile one exact-name template, read-only unless `apply` is true. */
export async function reconcileTemplate(
	context: TemplateOperationContext,
	input: TemplateDesiredState,
	options: TemplateReconcileOptions = {},
): Promise<TemplateReconcileResult> {
	const desired = createTemplateInputSchema.parse(input);
	const candidates = await listTemplatesForReconcile(context.client);
	const plan = await planTemplateFromCandidates(context, desired, candidates);
	if (options.apply !== true || plan.action === "unchanged") {
		return plan;
	}
	return applyTemplateReconcilePlan(context, desired, plan);
}

/** Ensure one exact-name template exists and matches the desired state. */
export async function ensureTemplate(
	context: TemplateOperationContext,
	input: TemplateDesiredState,
): Promise<TemplateReconcileResult> {
	return reconcileTemplate(context, input, { apply: true });
}

/**
 * Reconcile a versioned template manifest. The complete manifest is planned
 * before the first remote mutation. Remote writes are not transactional; an
 * apply failure exposes completed entries through TemplateManifestApplyError
 * so callers can reconcile the partial remote state.
 */
export async function reconcileTemplateManifest(
	context: TemplateOperationContext,
	input: TemplateManifest,
	options: TemplateReconcileOptions = {},
): Promise<TemplateManifestReconcileResult> {
	const manifest = templateManifestSchema.parse(input);
	const candidates = await listTemplatesForReconcile(context.client);
	const desiredTemplates = manifest.templates;
	const plannedTemplates: Array<{
		desired: z.output<typeof createTemplateInputSchema>;
		plan: TemplateReconcileResult;
	}> = [];
	// Bound concurrent detail reads so large manifests do not serialize all
	// network latency or create an unbounded burst against Listmonk.
	const planningConcurrency = 4;
	for (let offset = 0; offset < desiredTemplates.length; offset += planningConcurrency) {
		const batch = desiredTemplates.slice(offset, offset + planningConcurrency);
		plannedTemplates.push(
			...(await Promise.all(
				batch.map(async (desired) => ({
					desired,
					plan: await planTemplateFromCandidates(context, desired, candidates),
				})),
			)),
		);
	}
	const plans = plannedTemplates.map(({ plan }) => plan);
	if (options.apply !== true) {
		return { schema_version: 1, apply: false, results: plans };
	}

	const results: TemplateReconcileResult[] = [];
	for (const { desired, plan } of plannedTemplates) {
		try {
			results.push(await applyTemplateReconcilePlan(context, desired, plan));
		} catch (cause) {
			throw new TemplateManifestApplyError(desired.name, results, cause);
		}
	}
	return { schema_version: 1, apply: true, results };
}

async function listTemplatesForReconcile(
	client: Pick<ListmonkClient, "template">,
): Promise<Template[]> {
	// Listmonk 6.2 GetTemplates returns Core.GetTemplates directly and ignores
	// page/per_page. The SDK wraps that exhaustive array with synthetic list
	// metadata, so following the metadata as pagination would repeat the same
	// records rather than discover additional templates.
	const response = await client.template.list({ query: { no_body: true } });
	const data = unwrapResourceResponse(
		response,
		"Failed to list templates for reconcile",
	);
	return data.results ?? [];
}

function templateMatchesDesiredState(
	template: Template,
	desired: z.output<typeof createTemplateInputSchema>,
): boolean {
	return (
		template.name === desired.name &&
		template.type === desired.type &&
		(template.subject ?? "") === desired.subject &&
		// Listmonk 6.2 validates syntax without rewriting the body before it
		// persists the supplied value, so body remains an exact managed field.
		(template.body ?? "") === desired.body &&
		// Omitted body_source is unmanaged: Listmonk also preserves the current
		// value when its update request leaves this field absent or empty.
		(desired.body_source === undefined ||
			(template.body_source ?? "") === desired.body_source)
	);
}

export async function deleteTemplate(
	{ client }: TemplateOperationContext,
	input: z.output<typeof templateIdInputSchema>,
): Promise<z.output<typeof deleteTemplateOutputSchema>> {
	const response = await client.template.delete({ path: { id: input.id } });
	return {
		id: input.id,
		deleted: unwrapResourceResponse(response, "Failed to delete template"),
	};
}

export async function setDefaultTemplate(
	{ client }: TemplateOperationContext,
	input: z.output<typeof templateIdInputSchema>,
): Promise<z.output<typeof setDefaultTemplateOutputSchema>> {
	const response = await client.template.setAsDefault({
		path: { id: input.id },
	});
	// Listmonk 6.2 acknowledges this endpoint with an array even though its
	// upstream OpenAPI document declares a Template. Keep that transport detail
	// at the boundary and expose the stable requested-ID acknowledgement instead.
	unwrapResourceResponse(response, "Failed to set default template");
	return { id: input.id, set_default: true };
}

export const getTemplatesOperation = defineOperation({
	id: "templates.list",
	title: "List templates",
	description: "Get templates from Listmonk",
	inputSchema: templateListInputSchema,
	outputSchema: templateListOutputSchema,
	safety: readResourceSafety,
	mcp: { name: "listmonk_get_templates", legacySuccessText: jsonResourceValue },
	spec: bindTemplatesListOperationSpec(),
	execute: listTemplates,
});

export const getTemplateOperation = defineOperation({
	id: "templates.get",
	title: "Get template",
	description: "Get a template by ID",
	inputSchema: templateIdInputSchema,
	outputSchema: templateSchema,
	safety: readResourceSafety,
	mcp: { name: "listmonk_get_template", legacySuccessText: jsonResourceValue },
	spec: bindTemplatesGetOperationSpec(),
	execute: getTemplate,
});

export const createTemplateOperation = defineOperation({
	id: "templates.create",
	title: "Create template",
	description: "Create a template in Listmonk",
	inputSchema: createTemplateInputSchema,
	outputSchema: templateSchema,
	safety: createResourceSafety,
	mcp: {
		name: "listmonk_create_template",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindBridgedOperationSpec("templates.create"),
	execute: createTemplate,
});

export const updateTemplateOperation = defineOperation({
	id: "templates.update",
	title: "Update template",
	description: "Update a template in Listmonk",
	inputSchema: updateTemplateInputSchema,
	outputSchema: templateSchema,
	safety: updateResourceSafety,
	mcp: {
		name: "listmonk_update_template",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindBridgedOperationSpec("templates.update"),
	execute: updateTemplate,
});

export const deleteTemplateOperation = defineOperation({
	id: "templates.delete",
	title: "Delete template",
	description: "Delete a template from Listmonk",
	inputSchema: templateIdInputSchema,
	outputSchema: deleteTemplateOutputSchema,
	safety: deleteResourceSafety,
	mcp: {
		name: "listmonk_delete_template",
		legacySuccessText: "Template deleted successfully",
	},
	spec: bindBridgedOperationSpec("templates.delete"),
	execute: deleteTemplate,
});

export const setDefaultTemplateOperation = defineOperation({
	id: "templates.set-default",
	title: "Set default template",
	description: "Set a template as the Listmonk default",
	inputSchema: templateIdInputSchema,
	outputSchema: setDefaultTemplateOutputSchema,
	safety: updateResourceSafety,
	mcp: {
		name: "listmonk_set_default_template",
		legacySuccessText: "Default template set successfully",
	},
	spec: bindBridgedOperationSpec("templates.set-default"),
	execute: setDefaultTemplate,
});

export async function invokeGetTemplatesOperation(
	context: TemplateOperationContext,
	input: unknown,
): Promise<TemplateListPage> {
	const parsedInput = parseOperationInput(
		getTemplatesOperation.inputSchema,
		input,
	);
	let output: TemplateListPage;
	try {
		output = await listTemplates(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(getTemplatesOperation.id, error);
	}
	return parseOperationOutput(
		getTemplatesOperation.id,
		getTemplatesOperation.outputSchema,
		output,
	);
}

export async function invokeGetTemplateOperation(
	context: TemplateOperationContext,
	input: unknown,
): Promise<z.output<typeof templateSchema>> {
	const parsedInput = parseOperationInput(
		getTemplateOperation.inputSchema,
		input,
	);
	let output: z.output<typeof templateSchema>;
	try {
		output = await getTemplate(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(getTemplateOperation.id, error);
	}
	return parseOperationOutput(
		getTemplateOperation.id,
		getTemplateOperation.outputSchema,
		output,
	);
}

export async function invokeCreateTemplateOperation(
	context: TemplateOperationContext,
	input: unknown,
): Promise<z.output<typeof templateSchema>> {
	const parsedInput = parseOperationInput(
		createTemplateOperation.inputSchema,
		input,
	);
	let output: z.output<typeof templateSchema>;
	try {
		output = await createTemplate(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(createTemplateOperation.id, error);
	}
	return parseOperationOutput(
		createTemplateOperation.id,
		createTemplateOperation.outputSchema,
		output,
	);
}

export async function invokeUpdateTemplateOperation(
	context: TemplateOperationContext,
	input: unknown,
): Promise<z.output<typeof templateSchema>> {
	const parsedInput = parseOperationInput(
		updateTemplateOperation.inputSchema,
		input,
	);
	let output: z.output<typeof templateSchema>;
	try {
		output = await updateTemplate(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(updateTemplateOperation.id, error);
	}
	return parseOperationOutput(
		updateTemplateOperation.id,
		updateTemplateOperation.outputSchema,
		output,
	);
}

export async function invokeDeleteTemplateOperation(
	context: TemplateOperationContext,
	input: unknown,
): Promise<z.output<typeof deleteTemplateOutputSchema>> {
	const parsedInput = parseOperationInput(
		deleteTemplateOperation.inputSchema,
		input,
	);
	let output: z.output<typeof deleteTemplateOutputSchema>;
	try {
		output = await deleteTemplate(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(deleteTemplateOperation.id, error);
	}
	return parseOperationOutput(
		deleteTemplateOperation.id,
		deleteTemplateOperation.outputSchema,
		output,
	);
}

export async function invokeSetDefaultTemplateOperation(
	context: TemplateOperationContext,
	input: unknown,
): Promise<z.output<typeof setDefaultTemplateOutputSchema>> {
	const parsedInput = parseOperationInput(
		setDefaultTemplateOperation.inputSchema,
		input,
	);
	let output: z.output<typeof setDefaultTemplateOutputSchema>;
	try {
		output = await setDefaultTemplate(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(
			setDefaultTemplateOperation.id,
			error,
		);
	}
	return parseOperationOutput(
		setDefaultTemplateOperation.id,
		setDefaultTemplateOperation.outputSchema,
		output,
	);
}

export const templateOperations = [
	getTemplatesOperation,
	getTemplateOperation,
	createTemplateOperation,
	updateTemplateOperation,
	deleteTemplateOperation,
	setDefaultTemplateOperation,
] as const;

export const templateOperationCatalog = defineOperationCatalog({
	id: "templates",
	title: "Templates",
	operations: templateOperations,
	specMigrationExemptions: [],
});

export type TemplateOperation = (typeof templateOperations)[number];

const templateOperationsByMcpName = new Map<string, TemplateOperation>(
	templateOperations.map((operation) => [operation.mcp.name, operation]),
);

export function getTemplateOperationByMcpName(
	name: string,
): TemplateOperation | undefined {
	return templateOperationsByMcpName.get(name);
}

export interface TemplateOperationInvocation {
	operation: TemplateOperation;
	output: Record<string, unknown>;
}

export async function invokeTemplateOperationByMcpName(
	context: TemplateOperationContext,
	name: string,
	input: unknown,
): Promise<TemplateOperationInvocation | undefined> {
	switch (name) {
		case getTemplatesOperation.mcp.name:
			return {
				operation: getTemplatesOperation,
				output: await invokeGetTemplatesOperation(context, input),
			};
		case getTemplateOperation.mcp.name:
			return {
				operation: getTemplateOperation,
				output: await invokeGetTemplateOperation(context, input),
			};
		case createTemplateOperation.mcp.name:
			return {
				operation: createTemplateOperation,
				output: await invokeCreateTemplateOperation(context, input),
			};
		case updateTemplateOperation.mcp.name:
			return {
				operation: updateTemplateOperation,
				output: await invokeUpdateTemplateOperation(context, input),
			};
		case deleteTemplateOperation.mcp.name:
			return {
				operation: deleteTemplateOperation,
				output: await invokeDeleteTemplateOperation(context, input),
			};
		case setDefaultTemplateOperation.mcp.name:
			return {
				operation: setDefaultTemplateOperation,
				output: await invokeSetDefaultTemplateOperation(context, input),
			};
		default:
			return undefined;
	}
}
