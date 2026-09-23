import { resolveCliConfiguration } from "./configuration";
import * as clack from "@clack/prompts";
import { normalizeListmonkApiUrl } from "@listmonk-ops/common";
import {
	createListmonkClient,
	type ListmonkClient,
} from "@listmonk-ops/openapi";
import { getRuntimeFlags, type HandlerArgs } from "./command";

type UnknownFlags = Record<string, unknown>;
type ListmonkHandlerContext = Partial<HandlerArgs<UnknownFlags>>;

export interface ListmonkSession {
	baseUrl: string;
	username: string;
	apiToken?: string;
	client: ListmonkClient | null;
}

const normalizeApiUrl = normalizeListmonkApiUrl;

function shouldUseInteractivePrompt(args: ListmonkHandlerContext): boolean {
	const flags = { ...getRuntimeFlags(), ...(args.flags ?? {}) };
	const interactive = Boolean(flags.interactive || flags.tui);
	return interactive && Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function promptForTarget(defaults: {
	baseUrl: string;
	username: string;
	fixedTarget?: boolean;
}, title: string): Promise<{ baseUrl: string; username: string }> {
	clack.intro(title);

	const baseUrlResult = defaults.fixedTarget ? defaults.baseUrl : await clack.text({
		message: "Listmonk API URL",
		defaultValue: defaults.baseUrl,
		validate: (value = "") => {
			try {
				normalizeApiUrl(value);
				return undefined;
			} catch (error) {
				return error instanceof Error ? error.message : "Invalid API URL";
			}
		},
	});

	if (clack.isCancel(baseUrlResult)) {
		clack.cancel("Setup cancelled");
		throw new Error("Prompt cancelled by user");
	}

	const usernameResult = defaults.fixedTarget ? defaults.username : await clack.text({
		message: "Listmonk token username",
		defaultValue: defaults.username,
		validate: (value = "") =>
			value.trim().length > 0 ? undefined : "Username is required",
	});

	if (clack.isCancel(usernameResult)) {
		clack.cancel("Setup cancelled");
		throw new Error("Prompt cancelled by user");
	}

	return {
		baseUrl: normalizeApiUrl(baseUrlResult),
		username: usernameResult.trim(),
	};
}

async function promptForCredentials(defaults: {
	baseUrl: string;
	username: string;
	fixedTarget?: boolean;
}): Promise<{ baseUrl: string; username: string; apiToken: string }> {
	const target = await promptForTarget(
		defaults,
		"Listmonk authentication setup",
	);
	const tokenResult = await clack.password({
		message: "Listmonk API token",
		mask: "*",
		validate: (value = "") =>
			value.trim().length > 0 ? undefined : "API token is required",
	});

	if (clack.isCancel(tokenResult)) {
		clack.cancel("Setup cancelled");
		throw new Error("Prompt cancelled by user");
	}

	clack.outro("Credentials loaded for this command");

	return { ...target, apiToken: tokenResult.trim() };
}

export async function resolveListmonkSession(
	args: ListmonkHandlerContext = {},
	options: { requireAuth?: boolean; localOnly?: boolean } = {},
): Promise<ListmonkSession> {
	const requireAuth = options.requireAuth ?? true;

	const resolved = await resolveCliConfiguration();
	let baseUrl = resolved.summary.baseUrl;
	let username = resolved.summary.username;
	let apiToken: string | undefined;
	try {
		apiToken = await resolved.readCredential();
	} catch (error) {
		if (!options.localOnly) throw error;
	}

	if (!apiToken && requireAuth && shouldUseInteractivePrompt(args)) {
		const prompted = await promptForCredentials({
			baseUrl,
			username,
			fixedTarget: resolved.summary.profile !== undefined,
		});
		baseUrl = prompted.baseUrl;
		username = prompted.username;
		apiToken = prompted.apiToken;
	}
	if (!apiToken && options.localOnly && shouldUseInteractivePrompt(args)) {
		const selected = await promptForTarget(
			{
				baseUrl,
				username,
				fixedTarget: resolved.summary.profile !== undefined,
			},
			"Listmonk target selection",
		);
		baseUrl = selected.baseUrl;
		username = selected.username;
		clack.outro("Target selected for this command");
	}

	if (!apiToken) {
		if (requireAuth) {
			throw new Error(
				"Missing Listmonk API token. Set LISTMONK_API_TOKEN, configure a profile/token file, or run with --interactive.",
			);
		}

		return {
			baseUrl,
			username,
			client: null,
		};
	}

	const client = createListmonkClient({
		baseUrl,
		auth: {
			username,
			token: apiToken,
		},
	});

	return {
		baseUrl,
		username,
		apiToken,
		client,
	};
}

export async function getListmonkClient(
	args: ListmonkHandlerContext = {},
): Promise<ListmonkClient> {
	const session = await resolveListmonkSession(args, { requireAuth: true });
	if (!session.client) {
		throw new Error("Listmonk client is not available");
	}

	return session.client;
}
