import type { ProviderOperationContext } from "@listmonk-ops/automation";
import type { HandlerArgs } from "./command";
import { toErrorMessage } from "./command-utils";
import { resolveListmonkSession } from "./listmonk";

export async function runProviderCliCommand<T>(
	label: string,
	execute: () => Promise<T>,
): Promise<T> {
	try {
		return await execute();
	} catch (error) {
		throw new Error(`${label} failed: ${toErrorMessage(error)}`, {
			cause: error,
		});
	}
}

export async function resolveProviderOperationContext(
	args: Omit<HandlerArgs<Record<string, unknown>>, "flags">,
	requireListmonk: boolean,
): Promise<ProviderOperationContext> {
	const session = await resolveListmonkSession(args, {
		requireAuth: requireListmonk,
	});
	if (requireListmonk && !session.client) {
		throw new Error("Listmonk client is not available");
	}
	return {
		...(session.client === null ? {} : { client: session.client }),
	};
}
