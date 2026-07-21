import type { ListmonkClient, Template } from "@listmonk-ops/openapi";
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
	no_body: optionalBooleanSchema,
});

const createTemplateInputSchema = z.object({
	name: z.string().trim().min(1),
	type: templateTypeSchema.default("campaign"),
	subject: z.string().optional().default(""),
	body_source: z.string().optional(),
	body: z.string().min(1),
});

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
	return normalizeResourceList(data, {
		page: input.page,
		per_page: input.per_page,
	});
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

export const getTemplatesOperation = defineOperation({
	id: "templates.list",
	title: "List templates",
	description: "Get templates from Listmonk",
	inputSchema: templateListInputSchema,
	outputSchema: templateListOutputSchema,
	safety: readResourceSafety,
	mcp: { name: "listmonk_get_templates", legacySuccessText: jsonResourceValue },
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
	execute: getTemplate,
});

export const createTemplateOperation = defineOperation({
	id: "templates.create",
	title: "Create template",
	description: "Create a template in Listmonk",
	inputSchema: createTemplateInputSchema,
	outputSchema: templateSchema,
	safety: createResourceSafety,
	mcp: { name: "listmonk_create_template", legacySuccessText: jsonResourceValue },
	execute: createTemplate,
});

export const updateTemplateOperation = defineOperation({
	id: "templates.update",
	title: "Update template",
	description: "Update a template in Listmonk",
	inputSchema: updateTemplateInputSchema,
	outputSchema: templateSchema,
	safety: updateResourceSafety,
	mcp: { name: "listmonk_update_template", legacySuccessText: jsonResourceValue },
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
	execute: deleteTemplate,
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

export const templateOperations = [
	getTemplatesOperation,
	getTemplateOperation,
	createTemplateOperation,
	updateTemplateOperation,
	deleteTemplateOperation,
] as const;

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
		default:
			return undefined;
	}
}
