import { ValidationError } from "@listmonk-ops/common";
import type { List } from "@listmonk-ops/openapi";
import { BaseCommand } from "./base";
import type { ListmonkClient } from "./types";

// List Commands
export class ListSubscriberListsCommand extends BaseCommand<void, List[]> {
	constructor(private listmonkClient: ListmonkClient) {
		super();
	}

	async execute(): Promise<List[]> {
		const result = await this.listmonkClient.getLists();
		return result.data.results;
	}
}

export class GetSubscriberListCommand extends BaseCommand<string, List> {
	constructor(private listmonkClient: ListmonkClient) {
		super();
	}

	async execute(listId: string): Promise<List> {
		this.validate(listId);
		const result = await this.listmonkClient.getListById({
			path: { list_id: Number(listId) },
		});

		if ("error" in result) {
			throw new ValidationError(`List with ID ${listId} not found`);
		}

		return result.data;
	}

	protected override validate(listId: string): void {
		if (!listId || listId.trim().length === 0) {
			throw new ValidationError("List ID is required");
		}
		const id = Number(listId);
		if (Number.isNaN(id) || id <= 0) {
			throw new ValidationError("List ID must be a positive number");
		}
	}
}

// List command executors factory
export function createListExecutors(listmonkClient: ListmonkClient) {
	return {
		listSubscriberLists: (): Promise<List[]> =>
			new ListSubscriberListsCommand(listmonkClient).execute(),

		getSubscriberList: (id: string): Promise<List> =>
			new GetSubscriberListCommand(listmonkClient).execute(id),
	};
}
