import { OutputUtils } from "@listmonk-ops/common";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	invokeCreateSubscriberOperation,
	invokeDeleteSubscriberOperation,
	invokeGetSubscriberOperation,
	invokeGetSubscribersOperation,
	invokeUpdateSubscriberOperation,
	OperationExecutionError,
} from "@listmonk-ops/operations";
import { z } from "zod";
import {
	defineCommand,
	defineGroup,
	type HandlerArgs,
	option,
} from "../lib/command";
import {
	parseCsvNumbers,
	parseJson,
	toErrorMessage,
} from "../lib/command-utils";
import { getListmonkClient } from "../lib/listmonk";

type SubscribersOutput = Pick<
	typeof OutputUtils,
	"info" | "json" | "success" | "table"
>;

export interface SubscribersCliContext {
	client: Pick<ListmonkClient, "subscriber">;
	output: SubscribersOutput;
}

export interface ListSubscribersInput {
	page?: number;
	per_page?: number;
	list_id?: number[];
	query?: string;
	order_by?: "name" | "status" | "created_at" | "updated_at";
	order?: "ASC" | "DESC";
	subscription_status?: string;
}

export interface CreateSubscriberInput {
	email: string;
	name?: string;
	status?: "enabled" | "disabled" | "blocklisted";
	lists?: number[];
	list_uuids?: string[];
	preconfirm_subscriptions?: boolean;
	attribs?: Record<string, unknown>;
}

export type UpdateSubscriberInput = Partial<Omit<CreateSubscriberInput, "email">> & {
	id: number;
	email?: string;
};

export function createSubscriberCommandError(context: string, error: unknown): Error {
	if (error instanceof OperationExecutionError) return error;
	return new Error(`${context}: ${toErrorMessage(error)}`, { cause: error });
}

export async function renderSubscribers(
	context: SubscribersCliContext,
	input: ListSubscribersInput,
): Promise<void> {
	const page = await invokeGetSubscribersOperation(context, input);
	if (page.results.length === 0) {
		context.output.info("No subscribers found");
		return;
	}
	context.output.table(page.results as Record<string, unknown>[]);
}

export async function renderSubscriber(
	context: SubscribersCliContext,
	input: { id: number },
): Promise<void> {
	context.output.json(await invokeGetSubscriberOperation(context, input));
}

export async function renderCreateSubscriber(
	context: SubscribersCliContext,
	input: CreateSubscriberInput,
): Promise<void> {
	const subscriber = await invokeCreateSubscriberOperation(context, input);
	context.output.success(`Subscriber created: ${subscriber.id ?? input.email}`);
	context.output.json(subscriber);
}

export async function renderUpdateSubscriber(
	context: SubscribersCliContext,
	input: UpdateSubscriberInput,
): Promise<void> {
	const subscriber = await invokeUpdateSubscriberOperation(context, input);
	context.output.success(`Subscriber updated: ${input.id}`);
	context.output.json(subscriber);
}

export async function renderDeleteSubscriber(
	context: SubscribersCliContext,
	input: { id: number },
): Promise<void> {
	const result = await invokeDeleteSubscriberOperation(context, input);
	context.output.success(`Subscriber deleted: ${input.id}`);
	context.output.json(result);
}

type ListCommandFlags = {
	page?: number;
	"per-page"?: number;
	"list-id"?: string;
	query?: string;
	"order-by"?: "name" | "status" | "created_at" | "updated_at";
	order?: "ASC" | "DESC";
	"subscription-status"?: string;
};

export async function handleListSubscribersCommand({
	flags,
	...args
}: HandlerArgs<ListCommandFlags>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderSubscribers(
			{ client, output: OutputUtils },
			{
				page: flags.page,
				per_page: flags["per-page"],
				list_id: flags["list-id"]
					? parseCsvNumbers(flags["list-id"])
					: undefined,
				query: flags.query,
				order_by: flags["order-by"],
				order: flags.order,
				subscription_status: flags["subscription-status"],
			},
		);
	} catch (error) {
		throw createSubscriberCommandError("Failed to list subscribers", error);
	}
}

export async function handleGetSubscriberCommand({
	flags,
	...args
}: HandlerArgs<{ id: number }>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderSubscriber({ client, output: OutputUtils }, { id: flags.id });
	} catch (error) {
		throw createSubscriberCommandError("Failed to get subscriber", error);
	}
}

type CreateCommandFlags = {
	email: string;
	name?: string;
	status: "enabled" | "disabled" | "blocklisted";
	lists?: string;
	"list-uuids"?: string;
	"preconfirm-subscriptions"?: boolean;
	attribs?: string;
};

export async function handleCreateSubscriberCommand({
	flags,
	...args
}: HandlerArgs<CreateCommandFlags>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderCreateSubscriber(
			{ client, output: OutputUtils },
			{
				email: flags.email,
				name: flags.name,
				status: flags.status,
				lists: flags.lists ? parseCsvNumbers(flags.lists) : undefined,
				list_uuids: flags["list-uuids"]
					? flags["list-uuids"]
						.split(",")
						.map((value) => value.trim())
						.filter(Boolean)
					: undefined,
				preconfirm_subscriptions: flags["preconfirm-subscriptions"],
				attribs: flags.attribs
					? parseJson<Record<string, unknown>>(flags.attribs, "attribs")
					: undefined,
			},
		);
	} catch (error) {
		throw createSubscriberCommandError("Failed to create subscriber", error);
	}
}

type UpdateCommandFlags = {
	id: number;
	email?: string;
	name?: string;
	status?: "enabled" | "disabled" | "blocklisted";
	lists?: string;
	"list-uuids"?: string;
	"preconfirm-subscriptions"?: boolean;
	attribs?: string;
};

export async function handleUpdateSubscriberCommand({
	flags,
	...args
}: HandlerArgs<UpdateCommandFlags>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderUpdateSubscriber(
			{ client, output: OutputUtils },
			{
				id: flags.id,
				email: flags.email,
				name: flags.name,
				status: flags.status,
				lists: flags.lists ? parseCsvNumbers(flags.lists) : undefined,
				list_uuids: flags["list-uuids"]
					? flags["list-uuids"]
						.split(",")
						.map((value) => value.trim())
						.filter(Boolean)
					: undefined,
				preconfirm_subscriptions: flags["preconfirm-subscriptions"],
				attribs: flags.attribs
					? parseJson<Record<string, unknown>>(flags.attribs, "attribs")
					: undefined,
			},
		);
	} catch (error) {
		throw createSubscriberCommandError("Failed to update subscriber", error);
	}
}

export async function handleDeleteSubscriberCommand({
	flags,
	...args
}: HandlerArgs<{ id: number }>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderDeleteSubscriber(
			{ client, output: OutputUtils },
			{ id: flags.id },
		);
	} catch (error) {
		throw createSubscriberCommandError("Failed to delete subscriber", error);
	}
}

export default defineGroup({
	name: "subscribers",
	description: "Manage subscribers",
	commands: [
		defineCommand({
			name: "list",
			description: "List subscribers",
			options: {
				page: option(z.coerce.number().int().positive().optional(), { description: "Page number" }),
				"per-page": option(z.coerce.number().int().positive().optional(), { description: "Items per page" }),
				"list-id": option(z.string().trim().optional(), { description: "Comma-separated list IDs" }),
				query: option(z.string().trim().optional(), { description: "Search query" }),
				"order-by": option(z.enum(["name", "status", "created_at", "updated_at"]).optional(), { description: "Sort field" }),
				order: option(z.enum(["ASC", "DESC"]).optional(), { description: "Sort order" }),
				"subscription-status": option(z.string().trim().optional(), { description: "Subscription status" }),
			},
			handler: handleListSubscribersCommand,
		}),
		defineCommand({
			name: "get",
			description: "Get subscriber details",
			options: { id: option(z.coerce.number().int().positive(), { description: "Subscriber ID" }) },
			handler: handleGetSubscriberCommand,
		}),
		defineCommand({
			name: "create",
			description: "Create a subscriber",
			options: {
				email: option(z.string().trim().email(), { description: "Subscriber email" }),
				name: option(z.string().trim().optional(), { description: "Subscriber name" }),
				status: option(z.enum(["enabled", "disabled", "blocklisted"]).default("enabled"), { description: "Subscriber status" }),
				lists: option(z.string().trim().optional(), { description: "Comma-separated list IDs" }),
				"list-uuids": option(z.string().trim().optional(), { description: "Comma-separated list UUIDs" }),
				"preconfirm-subscriptions": option(z.boolean().optional(), { description: "Preconfirm subscriptions" }),
				attribs: option(z.string().optional(), { description: "Attributes JSON" }),
			},
			handler: handleCreateSubscriberCommand,
		}),
		defineCommand({
			name: "update",
			description: "Update a subscriber",
			options: {
				id: option(z.coerce.number().int().positive(), { description: "Subscriber ID" }),
				email: option(z.string().trim().email().optional(), { description: "Subscriber email" }),
				name: option(z.string().trim().optional(), { description: "Subscriber name" }),
				status: option(z.enum(["enabled", "disabled", "blocklisted"]).optional(), { description: "Subscriber status" }),
				lists: option(z.string().trim().optional(), { description: "Comma-separated list IDs" }),
				"list-uuids": option(z.string().trim().optional(), { description: "Comma-separated list UUIDs" }),
				"preconfirm-subscriptions": option(z.boolean().optional(), { description: "Preconfirm subscriptions" }),
				attribs: option(z.string().optional(), { description: "Attributes JSON" }),
			},
			handler: handleUpdateSubscriberCommand,
		}),
		defineCommand({
			name: "delete",
			description: "Delete a subscriber",
			options: { id: option(z.coerce.number().int().positive(), { description: "Subscriber ID" }) },
			handler: handleDeleteSubscriberCommand,
		}),
	],
});
