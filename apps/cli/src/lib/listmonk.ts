import type { HandlerArgs } from "@bunli/core";
import {
	createListmonkClient,
	type ListmonkClient,
} from "@listmonk-ops/openapi";

const DEFAULT_API_URL = "http://localhost:9000/api";
const DEFAULT_USERNAME = "api-admin";

type UnknownFlags = Record<string, unknown>;

export interface ListmonkSession {
	baseUrl: string;
	username: string;
	apiToken?: string;
	client: ListmonkClient | null;
}

function normalizeApiUrl(url: string): string {
	const trimmed = url.trim();
	if (!trimmed) {
		throw new Error("Listmonk API URL is required");
	}

	const base = trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
	const withApiSuffix = base.endsWith("/api") ? base : `${base}/api`;

	try {
		new URL(withApiSuffix);
	} catch {
		throw new Error(`Invalid Listmonk API URL: ${withApiSuffix}`);
	}

	return withApiSuffix;
}

function shouldUseInteractivePrompt(args: HandlerArgs<UnknownFlags>): boolean {
	const interactive = Boolean(args.flags.interactive || args.flags.tui);
	return interactive && args.terminal.isInteractive;
}

async function promptForCredentials(
	args: HandlerArgs<UnknownFlags>,
	defaults: { baseUrl: string; username: string },
): Promise<{ baseUrl: string; username: string; apiToken: string }> {
	const clack = args.prompt.clack;
	clack.intro("Listmonk authentication setup");

	const baseUrlResult = await clack.text({
		message: "Listmonk API URL",
		defaultValue: defaults.baseUrl,
		validate: (value) => {
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

	const usernameResult = await clack.text({
		message: "Listmonk token username",
		defaultValue: defaults.username,
		validate: (value) =>
			value.trim().length > 0 ? undefined : "Username is required",
	});

	if (clack.isCancel(usernameResult)) {
		clack.cancel("Setup cancelled");
		throw new Error("Prompt cancelled by user");
	}

	const tokenResult = await clack.password({
		message: "Listmonk API token",
		mask: "*",
		validate: (value) =>
			value.trim().length > 0 ? undefined : "API token is required",
	});

	if (clack.isCancel(tokenResult)) {
		clack.cancel("Setup cancelled");
		throw new Error("Prompt cancelled by user");
	}

	clack.outro("Credentials loaded for this command");

	return {
		baseUrl: normalizeApiUrl(baseUrlResult),
		username: usernameResult.trim(),
		apiToken: tokenResult.trim(),
	};
}

export async function resolveListmonkSession(
	args: HandlerArgs<UnknownFlags>,
	options: { requireAuth?: boolean } = {},
): Promise<ListmonkSession> {
	const requireAuth = options.requireAuth ?? true;

	let baseUrl = normalizeApiUrl(Bun.env.LISTMONK_API_URL || DEFAULT_API_URL);
	let username = Bun.env.LISTMONK_USERNAME?.trim() || DEFAULT_USERNAME;
	let apiToken = Bun.env.LISTMONK_API_TOKEN?.trim();

	if (!apiToken && requireAuth && shouldUseInteractivePrompt(args)) {
		const prompted = await promptForCredentials(args, { baseUrl, username });
		baseUrl = prompted.baseUrl;
		username = prompted.username;
		apiToken = prompted.apiToken;
	}

	if (!apiToken) {
		if (requireAuth) {
			throw new Error(
				"Missing LISTMONK_API_TOKEN. Set env vars or run with --interactive.",
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
	args: HandlerArgs<UnknownFlags>,
): Promise<ListmonkClient> {
	const session = await resolveListmonkSession(args, { requireAuth: true });
	if (!session.client) {
		throw new Error("Listmonk client is not available");
	}

	return session.client;
}
