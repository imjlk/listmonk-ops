import type { OutputUtils } from "@listmonk-ops/common";
import { getOutput } from "../lib/output";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	invokeAddSubscribersToListsOperation,
	invokeBlocklistSubscribersOperation,
	invokeCreateSubscriberOperation,
	invokeDeleteSubscriberOperation,
	invokeGetSubscriberOperation,
	invokeGetSubscribersOperation,
	invokeRemoveSubscribersFromListsOperation,
	invokeUnblocklistSubscribersOperation,
	invokeStartSubscriberImportOperation,
	invokeGetSubscriberImportStatusOperation,
	invokeStopSubscriberImportOperation,
	MAX_SUBSCRIBER_IMPORT_CSV_BYTES,
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
	parseCsvNumbersStrict,
	parseJson,
	toErrorMessage,
} from "../lib/command-utils";
import { getListmonkClient, resolveListmonkSession } from "../lib/listmonk";

type SubscribersOutput = Pick<
	typeof OutputUtils,
	"info" | "json" | "success" | "table" | "warning"
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
) {
	const result = await invokeCreateSubscriberOperation(context, input);
	const { subscriber, created } = result;
	context.output.success(
		created
			? `Subscriber created: ${subscriber.id ?? input.email}`
			: `Subscriber already exists: ${subscriber.id ?? input.email}`,
	);
	context.output.json(result);
	// Return the full envelope so the operation lifecycle hook can suppress
	// the subscriber.created event when the call was a replay.
	return result;
}

export async function renderUpdateSubscriber(
	context: SubscribersCliContext,
	input: UpdateSubscriberInput,
) {
	const subscriber = await invokeUpdateSubscriberOperation(context, input);
	context.output.success(`Subscriber updated: ${input.id}`);
	context.output.json(subscriber);
	return subscriber;
}

export async function renderDeleteSubscriber(
	context: SubscribersCliContext,
	input: { id: number },
): Promise<void> {
	const result = await invokeDeleteSubscriberOperation(context, input);
	context.output.success(`Subscriber deleted: ${input.id}`);
	context.output.json(result);
}

interface SubscriberBulkListsInput {
	subscriber_ids: number[];
	list_ids: number[];
	dry_run?: boolean;
	max_items?: number;
	continue_on_error?: boolean;
}

interface SubscriberBulkBlocklistInput {
	subscriber_ids: number[];
	dry_run?: boolean;
	max_items?: number;
	continue_on_error?: boolean;
}

interface SubscriberBulkUnblocklistInput {
	subscriber_ids: number[];
	dry_run?: boolean;
	max_items?: number;
	continue_on_error?: boolean;
}

interface BulkResultSummary {
	processed: number;
	succeeded: number;
	failed: number;
	errors: string[];
}

/**
 * Print a bulk operation summary. Emits a dry-run, success, or partial-
 * failure message depending on the result. When chunks failed and
 * `continue_on_error` was set, the partial failure is surfaced through
 * `output.warning` so it is not buried in the JSON payload.
 */
function reportBulkResult(
	context: SubscribersCliContext,
	input: { dry_run?: boolean },
	result: BulkResultSummary,
	verbPast: string,
	noun: string,
): void {
	if (input.dry_run) {
		context.output.success(
			`Dry run: would have ${verbPast} ${result.processed} ${noun}`,
		);
	} else if (result.failed > 0) {
		// Partial failure: lead with the warning so the operator sees the
		// failure before the success summary, then print the partial
		// succeeded count as info so it is not presented as a clean ✅.
		const visibleErrors = result.errors.slice(0, 3);
		const moreErrors =
			result.errors.length > visibleErrors.length
				? `; +${result.errors.length - visibleErrors.length} more (see JSON output)`
				: "";
		context.output.warning(
			`${result.failed} subscriber(s) failed across ${result.errors.length} chunk(s): ${visibleErrors.join("; ")}${moreErrors}`,
		);
		context.output.info(
			`${verbPast[0]?.toUpperCase()}${verbPast.slice(1)} ${result.succeeded} of ${result.processed} ${noun} (partial)`,
		);
	} else {
		context.output.success(
			`${verbPast[0]?.toUpperCase()}${verbPast.slice(1)} ${result.succeeded} of ${result.processed} ${noun}`,
		);
	}
	context.output.json(result);
}

export async function renderAddSubscribersToLists(
	context: SubscribersCliContext,
	input: SubscriberBulkListsInput,
): Promise<void> {
	const result = await invokeAddSubscribersToListsOperation(context, input);
	reportBulkResult(context, input, result, "added", "subscribers to lists");
}

export async function renderRemoveSubscribersFromLists(
	context: SubscribersCliContext,
	input: SubscriberBulkListsInput,
): Promise<void> {
	const result = await invokeRemoveSubscribersFromListsOperation(
		context,
		input,
	);
	reportBulkResult(context, input, result, "removed", "subscribers from lists");
}

export async function renderBlocklistSubscribers(
	context: SubscribersCliContext,
	input: SubscriberBulkBlocklistInput,
) {
	const result = await invokeBlocklistSubscribersOperation(context, input);
	reportBulkResult(context, input, result, "blocklisted", "subscribers");
	return result;
}

export interface SubscriberImportCliContext {
	client: Pick<ListmonkClient, "import">;
	output: Pick<typeof OutputUtils, "info" | "json" | "success">;
}

export async function renderStartSubscriberImport(
	context: SubscriberImportCliContext,
	input: {
		mode: "subscribe" | "blocklist";
		delim: string;
		lists?: number[];
		overwrite: boolean;
		subscription_status?: "pending" | "confirmed" | "unsubscribed";
		csv: string;
	},
): Promise<void> {
	const status = await invokeStartSubscriberImportOperation(context, input);
	context.output.success(
		`Subscriber import started (${status.status ?? "importing"})`,
	);
	context.output.json(status);
}

export async function renderSubscriberImportStatus(
	context: SubscriberImportCliContext,
): Promise<void> {
	const status = await invokeGetSubscriberImportStatusOperation(context, {});
	context.output.info(
		`Subscriber import: ${status.status ?? "unknown"} (${status.imported ?? 0}/${status.total ?? 0})`,
	);
	context.output.json(status);
}

export async function renderStopSubscriberImport(
	context: SubscriberImportCliContext,
): Promise<void> {
	const status = await invokeStopSubscriberImportOperation(context, {});
	context.output.success(
		`Subscriber import stopped (${status.status ?? "none"})`,
	);
	context.output.json(status);
}

export async function handleStartSubscriberImportCommand({
	flags,
	...args
}: HandlerArgs<{
	mode: "subscribe" | "blocklist";
	delim: string;
	lists?: string;
	overwrite?: boolean;
	"subscription-status"?: "pending" | "confirmed" | "unsubscribed";
	file: string;
}>): Promise<void> {
	try {
		const session = await resolveListmonkSession(args, {
			requireAuth: true,
		});
		if (!session.client) {
			throw new Error("Listmonk client is not available");
		}
		const file = Bun.file(flags.file);
		// Bun.file() does not throw when the path is missing — probe
		// existence explicitly so a clear "not found" message surfaces.
		if (!(await file.exists())) {
			throw new Error(`File not found: ${flags.file}`);
		}
		// Bun.file exposes size lazily without reading the file, so reject
		// oversized CSVs before pulling the bytes into memory.
		if (file.size > MAX_SUBSCRIBER_IMPORT_CSV_BYTES) {
			throw new Error(
				`File ${flags.file} is ${file.size} bytes, which exceeds the ${MAX_SUBSCRIBER_IMPORT_CSV_BYTES}-byte subscriber import CSV cap`,
			);
		}
		const csv = await file.text();
		await renderStartSubscriberImport(
			{ client: session.client, output: getOutput() },
			{
				mode: flags.mode,
				delim: flags.delim,
				lists: flags.lists
					? parseCsvNumbersStrict(flags.lists, "list IDs")
					: undefined,
				overwrite: flags.overwrite ?? false,
				subscription_status: flags["subscription-status"],
				csv,
			},
		);
	} catch (error) {
		throw createSubscriberCommandError(
			"Failed to start subscriber import",
			error,
		);
	}
}

export async function handleSubscriberImportStatusCommand({
	...args
}: HandlerArgs<Record<string, unknown>>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderSubscriberImportStatus({ client, output: getOutput() });
	} catch (error) {
		throw createSubscriberCommandError(
			"Failed to read subscriber import status",
			error,
		);
	}
}

export async function handleStopSubscriberImportCommand({
	...args
}: HandlerArgs<Record<string, unknown>>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderStopSubscriberImport({ client, output: getOutput() });
	} catch (error) {
		throw createSubscriberCommandError(
			"Failed to stop subscriber import",
			error,
		);
	}
}

export async function renderUnblocklistSubscribers(
	context: SubscribersCliContext,
	input: SubscriberBulkUnblocklistInput,
): Promise<void> {
	const result = await invokeUnblocklistSubscribersOperation(context, input);
	reportBulkResult(context, input, result, "unblocklisted", "subscribers");
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
			{ client, output: getOutput() },
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
		await renderSubscriber({ client, output: getOutput() }, { id: flags.id });
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
}: HandlerArgs<CreateCommandFlags>) {
	try {
		const client = await getListmonkClient(args);
		return await renderCreateSubscriber(
			{ client, output: getOutput() },
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
}: HandlerArgs<UpdateCommandFlags>) {
	try {
		const client = await getListmonkClient(args);
		return await renderUpdateSubscriber(
			{ client, output: getOutput() },
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
			{ client, output: getOutput() },
			{ id: flags.id },
		);
	} catch (error) {
		throw createSubscriberCommandError("Failed to delete subscriber", error);
	}
}

type SubscriberBulkListsFlags = {
	"subscriber-ids": string;
	"list-ids": string;
	"dry-run"?: boolean;
	"max-items"?: number;
	"continue-on-error"?: boolean;
};

type SubscriberBulkBlocklistFlags = {
	"subscriber-ids": string;
	"dry-run"?: boolean;
	"max-items"?: number;
	"continue-on-error"?: boolean;
};

async function handleAddSubscribersToListsCommand({
	flags,
	...args
}: HandlerArgs<SubscriberBulkListsFlags>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderAddSubscribersToLists(
			{ client, output: getOutput() },
			{
				subscriber_ids: parseCsvNumbersStrict(
					flags["subscriber-ids"],
					"subscriber IDs",
				),
				list_ids: parseCsvNumbersStrict(flags["list-ids"], "list IDs"),
				dry_run: flags["dry-run"],
				max_items: flags["max-items"],
				continue_on_error: flags["continue-on-error"],
			},
		);
	} catch (error) {
		throw createSubscriberCommandError(
			"Failed to add subscribers to lists",
			error,
		);
	}
}

async function handleRemoveSubscribersFromListsCommand({
	flags,
	...args
}: HandlerArgs<SubscriberBulkListsFlags>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderRemoveSubscribersFromLists(
			{ client, output: getOutput() },
			{
				subscriber_ids: parseCsvNumbersStrict(
					flags["subscriber-ids"],
					"subscriber IDs",
				),
				list_ids: parseCsvNumbersStrict(flags["list-ids"], "list IDs"),
				dry_run: flags["dry-run"],
				max_items: flags["max-items"],
				continue_on_error: flags["continue-on-error"],
			},
		);
	} catch (error) {
		throw createSubscriberCommandError(
			"Failed to remove subscribers from lists",
			error,
		);
	}
}

async function handleBlocklistSubscribersCommand({
	flags,
	...args
}: HandlerArgs<SubscriberBulkBlocklistFlags>) {
	try {
		const client = await getListmonkClient(args);
		return await renderBlocklistSubscribers(
			{ client, output: getOutput() },
			{
				subscriber_ids: parseCsvNumbersStrict(
					flags["subscriber-ids"],
					"subscriber IDs",
				),
				dry_run: flags["dry-run"],
				max_items: flags["max-items"],
				continue_on_error: flags["continue-on-error"],
			},
		);
	} catch (error) {
		throw createSubscriberCommandError(
			"Failed to blocklist subscribers",
			error,
		);
	}
}

async function handleUnblocklistSubscribersCommand({
	flags,
	...args
}: HandlerArgs<SubscriberBulkBlocklistFlags>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderUnblocklistSubscribers(
			{ client, output: getOutput() },
			{
				subscriber_ids: parseCsvNumbersStrict(
					flags["subscriber-ids"],
					"subscriber IDs",
				),
				dry_run: flags["dry-run"],
				max_items: flags["max-items"],
				continue_on_error: flags["continue-on-error"],
			},
		);
	} catch (error) {
		throw createSubscriberCommandError(
			"Failed to unblocklist subscribers",
			error,
		);
	}
}

export default defineGroup({
	name: "subscribers",
	description: "Manage subscribers",
	commands: [
		defineCommand({
			name: "list",
			operationId: "subscribers.list",
			description: "List subscribers",
			options: {
				page: option(z.coerce.number().int().positive().optional(), {
					description: "Page number",
				}),
				"per-page": option(z.coerce.number().int().positive().optional(), {
					description: "Items per page",
				}),
				"list-id": option(z.string().trim().optional(), {
					description: "Comma-separated list IDs",
				}),
				query: option(z.string().trim().optional(), {
					description: "Search query",
				}),
				"order-by": option(
					z.enum(["name", "status", "created_at", "updated_at"]).optional(),
					{ description: "Sort field" },
				),
				order: option(z.enum(["ASC", "DESC"]).optional(), {
					description: "Sort order",
				}),
				"subscription-status": option(z.string().trim().optional(), {
					description: "Subscription status",
				}),
			},
			handler: handleListSubscribersCommand,
		}),
		defineCommand({
			name: "get",
			operationId: "subscribers.get",
			description: "Get subscriber details",
			options: {
				id: option(z.coerce.number().int().positive(), {
					description: "Subscriber ID",
				}),
			},
			handler: handleGetSubscriberCommand,
		}),
		defineCommand({
			name: "create",
			operationId: "subscribers.create",
			description: "Create a subscriber",
			options: {
				email: option(z.string().trim().email(), {
					description: "Subscriber email",
				}),
				name: option(z.string().trim().optional(), {
					description: "Subscriber name",
				}),
				status: option(
					z.enum(["enabled", "disabled", "blocklisted"]).default("enabled"),
					{ description: "Subscriber status" },
				),
				lists: option(z.string().trim().optional(), {
					description: "Comma-separated list IDs",
				}),
				"list-uuids": option(z.string().trim().optional(), {
					description: "Comma-separated list UUIDs",
				}),
				"preconfirm-subscriptions": option(z.boolean().optional(), {
					description: "Preconfirm subscriptions",
				}),
				attribs: option(z.string().optional(), {
					description: "Attributes JSON",
				}),
			},
			handler: handleCreateSubscriberCommand,
		}),
		defineCommand({
			name: "update",
			operationId: "subscribers.update",
			description: "Update a subscriber",
			options: {
				id: option(z.coerce.number().int().positive(), {
					description: "Subscriber ID",
				}),
				email: option(z.string().trim().email().optional(), {
					description: "Subscriber email",
				}),
				name: option(z.string().trim().optional(), {
					description: "Subscriber name",
				}),
				status: option(
					z.enum(["enabled", "disabled", "blocklisted"]).optional(),
					{ description: "Subscriber status" },
				),
				lists: option(z.string().trim().optional(), {
					description: "Comma-separated list IDs",
				}),
				"list-uuids": option(z.string().trim().optional(), {
					description: "Comma-separated list UUIDs",
				}),
				"preconfirm-subscriptions": option(z.boolean().optional(), {
					description: "Preconfirm subscriptions",
				}),
				attribs: option(z.string().optional(), {
					description: "Attributes JSON",
				}),
			},
			handler: handleUpdateSubscriberCommand,
		}),
		defineCommand({
			name: "delete",
			operationId: "subscribers.delete",
			description: "Delete a subscriber",
			options: {
				id: option(z.coerce.number().int().positive(), {
					description: "Subscriber ID",
				}),
			},
			handler: handleDeleteSubscriberCommand,
		}),
		defineCommand({
			name: "add-to-lists",
			operationId: "subscribers.add-to-lists",
			description: "Add a batch of subscribers to one or more lists",
			options: {
				"subscriber-ids": option(z.string().trim().min(1), {
					description: "Comma-separated subscriber IDs",
				}),
				"list-ids": option(z.string().trim().min(1), {
					description: "Comma-separated list IDs",
				}),
				"dry-run": option(z.coerce.boolean().default(false), {
					description: "Skip the API calls and report what would have run",
				}),
				"max-items": option(z.coerce.number().int().positive().default(10000), {
					description: "Maximum number of subscriber IDs to process",
				}),
				"continue-on-error": option(z.coerce.boolean().default(false), {
					description: "Keep processing chunks after a failure",
				}),
			},
			handler: handleAddSubscribersToListsCommand,
		}),
		defineCommand({
			name: "remove-from-lists",
			operationId: "subscribers.remove-from-lists",
			description: "Remove a batch of subscribers from one or more lists",
			options: {
				"subscriber-ids": option(z.string().trim().min(1), {
					description: "Comma-separated subscriber IDs",
				}),
				"list-ids": option(z.string().trim().min(1), {
					description: "Comma-separated list IDs",
				}),
				"dry-run": option(z.coerce.boolean().default(false), {
					description: "Skip the API calls and report what would have run",
				}),
				"max-items": option(z.coerce.number().int().positive().default(10000), {
					description: "Maximum number of subscriber IDs to process",
				}),
				"continue-on-error": option(z.coerce.boolean().default(false), {
					description: "Keep processing chunks after a failure",
				}),
			},
			handler: handleRemoveSubscribersFromListsCommand,
		}),
		defineCommand({
			name: "blocklist",
			operationId: "subscribers.blocklist",
			description: "Add a batch of subscribers to the blocklist",
			options: {
				"subscriber-ids": option(z.string().trim().min(1), {
					description: "Comma-separated subscriber IDs",
				}),
				"dry-run": option(z.coerce.boolean().default(false), {
					description: "Skip the API calls and report what would have run",
				}),
				"max-items": option(z.coerce.number().int().positive().default(10000), {
					description: "Maximum number of subscriber IDs to process",
				}),
				"continue-on-error": option(z.coerce.boolean().default(false), {
					description: "Keep processing chunks after a failure",
				}),
			},
			handler: handleBlocklistSubscribersCommand,
		}),
		defineCommand({
			name: "unblocklist",
			operationId: "subscribers.unblocklist",
			description: "Remove a batch of subscribers from the blocklist",
			options: {
				"subscriber-ids": option(z.string().trim().min(1), {
					description: "Comma-separated subscriber IDs",
				}),
				"dry-run": option(z.coerce.boolean().default(false), {
					description: "Skip the API calls and report what would have run",
				}),
				"max-items": option(z.coerce.number().int().positive().default(10000), {
					description: "Maximum number of subscriber IDs to process",
				}),
				"continue-on-error": option(z.coerce.boolean().default(false), {
					description: "Keep processing chunks after a failure",
				}),
			},
			handler: handleUnblocklistSubscribersCommand,
		}),
		defineCommand({
			name: "import",
			operationId: "subscribers.import.start",
			description: "Start an asynchronous subscriber CSV import",
			options: {
				mode: option(z.enum(["subscribe", "blocklist"]), {
					description: "Whether rows subscribe or join the blocklist",
				}),
				delim: option(z.string().min(1).max(1).default(","), {
					description: "CSV column delimiter (single character)",
				}),
				lists: option(z.string().trim().min(1).optional(), {
					description:
						"Comma-separated target list ids (required for subscribe mode)",
				}),
				overwrite: option(z.coerce.boolean().default(false), {
					description: "Overwrite existing subscriber attributes",
				}),
				"subscription-status": option(
					z.enum(["pending", "confirmed", "unsubscribed"]).optional(),
					{ description: "Subscription status applied to imported rows" },
				),
				file: option(z.string().trim().min(1), {
					description: "Path to the CSV file (first row must be a header)",
					fileType: "path",
				}),
			},
			handler: handleStartSubscriberImportCommand,
		}),
		defineCommand({
			name: "import-status",
			operationId: "subscribers.import.status",
			description: "Read the subscriber import session status",
			options: {},
			handler: handleSubscriberImportStatusCommand,
		}),
		defineCommand({
			name: "import-stop",
			operationId: "subscribers.import.stop",
			description: "Stop the running subscriber import",
			options: {},
			handler: handleStopSubscriberImportCommand,
		}),
	],
});
