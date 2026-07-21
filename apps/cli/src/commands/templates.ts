import { OutputUtils } from "@listmonk-ops/common";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	invokeCreateTemplateOperation,
	invokeDeleteTemplateOperation,
	invokeGetTemplateOperation,
	invokeGetTemplatesOperation,
	invokeUpdateTemplateOperation,
	OperationExecutionError,
} from "@listmonk-ops/operations";
import { z } from "zod";
import {
	defineCommand,
	defineGroup,
	type HandlerArgs,
	option,
} from "../lib/command";
import { hasApiError, toErrorMessage } from "../lib/command-utils";
import { getListmonkClient } from "../lib/listmonk";

type TemplatesOutput = Pick<
	typeof OutputUtils,
	"info" | "json" | "success" | "table"
>;

export interface TemplatesCliContext {
	client: Pick<ListmonkClient, "template">;
	output: TemplatesOutput;
}

export interface ListTemplatesInput {
	page?: number;
	per_page?: number;
	no_body?: boolean;
}

export interface CreateTemplateInput {
	name: string;
	type?: "campaign" | "campaign_visual" | "tx";
	subject?: string;
	body_source?: string;
	body: string;
}

export type UpdateTemplateInput = Partial<CreateTemplateInput> & { id: number };

export function createTemplateCommandError(context: string, error: unknown): Error {
	if (error instanceof OperationExecutionError) return error;
	return new Error(`${context}: ${toErrorMessage(error)}`, { cause: error });
}

export async function renderTemplates(
	context: TemplatesCliContext,
	input: ListTemplatesInput,
): Promise<void> {
	const page = await invokeGetTemplatesOperation(context, input);
	if (page.results.length === 0) {
		context.output.info("No templates found");
		return;
	}
	context.output.table(page.results as Record<string, unknown>[]);
}

export async function renderTemplate(
	context: TemplatesCliContext,
	input: { id: number },
): Promise<void> {
	context.output.json(await invokeGetTemplateOperation(context, input));
}

export async function renderCreateTemplate(
	context: TemplatesCliContext,
	input: CreateTemplateInput,
): Promise<void> {
	const template = await invokeCreateTemplateOperation(context, input);
	context.output.success(`Template created: ${template.id ?? input.name}`);
	context.output.json(template);
}

export async function renderUpdateTemplate(
	context: TemplatesCliContext,
	input: UpdateTemplateInput,
): Promise<void> {
	const template = await invokeUpdateTemplateOperation(context, input);
	context.output.success(`Template updated: ${input.id}`);
	context.output.json(template);
}

export async function renderDeleteTemplate(
	context: TemplatesCliContext,
	input: { id: number },
): Promise<void> {
	const result = await invokeDeleteTemplateOperation(context, input);
	context.output.success(`Template deleted: ${input.id}`);
	context.output.json(result);
}

type ListCommandFlags = { page?: number; "per-page"?: number; "no-body"?: boolean };

export async function handleListTemplatesCommand({
	flags,
	...args
}: HandlerArgs<ListCommandFlags>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderTemplates(
			{ client, output: OutputUtils },
			{
				page: flags.page,
				per_page: flags["per-page"],
				no_body: flags["no-body"],
			},
		);
	} catch (error) {
		throw createTemplateCommandError("Failed to list templates", error);
	}
}

export async function handleGetTemplateCommand({
	flags,
	...args
}: HandlerArgs<{ id: number }>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderTemplate({ client, output: OutputUtils }, { id: flags.id });
	} catch (error) {
		throw createTemplateCommandError("Failed to get template", error);
	}
}

type CreateCommandFlags = {
	name: string;
	type: "campaign" | "campaign_visual" | "tx";
	subject?: string;
	body: string;
	"body-source"?: string;
};

export async function handleCreateTemplateCommand({
	flags,
	...args
}: HandlerArgs<CreateCommandFlags>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderCreateTemplate(
			{ client, output: OutputUtils },
			{
				name: flags.name,
				type: flags.type,
				subject: flags.subject,
				body: flags.body,
				body_source: flags["body-source"],
			},
		);
	} catch (error) {
		throw createTemplateCommandError("Failed to create template", error);
	}
}

type UpdateCommandFlags = {
	id: number;
	name?: string;
	type?: "campaign" | "campaign_visual" | "tx";
	subject?: string;
	body?: string;
	"body-source"?: string;
};

export async function handleUpdateTemplateCommand({
	flags,
	...args
}: HandlerArgs<UpdateCommandFlags>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderUpdateTemplate(
			{ client, output: OutputUtils },
			{
				id: flags.id,
				name: flags.name,
				type: flags.type,
				subject: flags.subject,
				body: flags.body,
				body_source: flags["body-source"],
			},
		);
	} catch (error) {
		throw createTemplateCommandError("Failed to update template", error);
	}
}

export async function handleDeleteTemplateCommand({
	flags,
	...args
}: HandlerArgs<{ id: number }>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderDeleteTemplate(
			{ client, output: OutputUtils },
			{ id: flags.id },
		);
	} catch (error) {
		throw createTemplateCommandError("Failed to delete template", error);
	}
}

export async function handleSetDefaultTemplateCommand({
	flags,
	...args
}: HandlerArgs<{ id: number }>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		const response = await client.template.setAsDefault({
			path: { id: flags.id },
		});
		if (hasApiError(response)) throw new Error(toErrorMessage(response.error));
		OutputUtils.success(`Default template set: ${flags.id}`);
		OutputUtils.json(response.data);
	} catch (error) {
		throw createTemplateCommandError("Failed to set default template", error);
	}
}

const templateTypeOption = z.enum(["campaign", "campaign_visual", "tx"]).default(
	"campaign",
);

export default defineGroup({
	name: "templates",
	description: "Manage templates",
	commands: [
		defineCommand({
			name: "list",
			description: "List templates",
			options: {
				page: option(z.coerce.number().int().positive().optional(), { description: "Page number" }),
				"per-page": option(z.coerce.number().int().positive().optional(), { description: "Items per page" }),
				"no-body": option(z.boolean().optional(), { description: "Omit template bodies" }),
			},
			handler: handleListTemplatesCommand,
		}),
		defineCommand({
			name: "get",
			description: "Get template details",
			options: { id: option(z.coerce.number().int().positive(), { description: "Template ID" }) },
			handler: handleGetTemplateCommand,
		}),
		defineCommand({
			name: "create",
			description: "Create a template",
			options: {
				name: option(z.string().trim().min(1), { description: "Template name" }),
				type: option(templateTypeOption, { description: "Template type" }),
				subject: option(z.string().trim().optional(), { description: "Email subject" }),
				body: option(z.string().min(1), { description: "Template body" }),
				"body-source": option(z.string().optional(), { description: "Visual editor source" }),
			},
			handler: handleCreateTemplateCommand,
		}),
		defineCommand({
			name: "update",
			description: "Update a template",
			options: {
				id: option(z.coerce.number().int().positive(), { description: "Template ID" }),
				name: option(z.string().trim().min(1).optional(), { description: "Template name" }),
				type: option(z.enum(["campaign", "campaign_visual", "tx"]).optional(), { description: "Template type" }),
				subject: option(z.string().optional(), { description: "Email subject" }),
				body: option(z.string().min(1).optional(), { description: "Template body" }),
				"body-source": option(z.string().optional(), { description: "Visual editor source" }),
			},
			handler: handleUpdateTemplateCommand,
		}),
		defineCommand({
			name: "delete",
			description: "Delete a template",
			options: { id: option(z.coerce.number().int().positive(), { description: "Template ID" }) },
			handler: handleDeleteTemplateCommand,
		}),
		defineCommand({
			name: "set-default",
			description: "Set a template as default",
			options: { id: option(z.coerce.number().int().positive(), { description: "Template ID" }) },
			handler: handleSetDefaultTemplateCommand,
		}),
	],
});
