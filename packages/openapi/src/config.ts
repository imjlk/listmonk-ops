import {
	DEFAULT_RETRIES,
	DEFAULT_TIMEOUT_MS,
	MAX_RETRIES,
	MAX_TIMEOUT_MS,
} from "./client/transport";

/**
 * Configuration interface for Listmonk client
 */
export interface ListmonkConfig {
	baseUrl: string;
	auth: {
		username: string;
		token: string;
	};
	timeout?: number;
	retries?: number;
	headers?: Record<string, string>;
}

/**
 * Environment configuration
 */
interface EnvConfig {
	LISTMONK_API_URL?: string;
	LISTMONK_USERNAME?: string;
	LISTMONK_API_TOKEN?: string;
	LISTMONK_TIMEOUT?: string;
	LISTMONK_RETRIES?: string;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG = {
	baseUrl: "http://localhost:9000/api",
	auth: {
		username: "api-admin",
		token: "",
	},
	timeout: DEFAULT_TIMEOUT_MS,
	retries: DEFAULT_RETRIES,
	headers: {},
} as const;

function readEnvironment(): EnvConfig {
	// Runtimes such as Workers or browsers have no `process`; treat them as
	// having no environment rather than throwing.
	const env =
		typeof process === "undefined" || process.env === undefined
			? {}
			: process.env;
	return {
		LISTMONK_API_URL: env.LISTMONK_API_URL,
		LISTMONK_USERNAME: env.LISTMONK_USERNAME,
		LISTMONK_API_TOKEN: env.LISTMONK_API_TOKEN,
		LISTMONK_TIMEOUT: env.LISTMONK_TIMEOUT,
		LISTMONK_RETRIES: env.LISTMONK_RETRIES,
	};
}

/**
 * Parse a bounded non-negative integer environment variable. `parseInt`
 * would turn `abc` into NaN (no request is ever attempted) and `30s` into 30.
 */
function parseIntegerEnv(
	name: string,
	raw: string | undefined,
	min: number,
	max: number,
): number | undefined {
	const value = raw?.trim();
	if (value === undefined || value === "") {
		return undefined;
	}
	const parsed = /^\d+$/.test(value) ? Number(value) : Number.NaN;
	if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
		throw new Error(
			`${name} must be an integer between ${min} and ${max}; received ${JSON.stringify(raw)}`,
		);
	}
	return parsed;
}

function readTimeoutEnvironment(): number | undefined {
	return parseIntegerEnv(
		"LISTMONK_TIMEOUT",
		readEnvironment().LISTMONK_TIMEOUT,
		1,
		MAX_TIMEOUT_MS,
	);
}

function readRetriesEnvironment(): number | undefined {
	return parseIntegerEnv(
		"LISTMONK_RETRIES",
		readEnvironment().LISTMONK_RETRIES,
		0,
		MAX_RETRIES,
	);
}

/**
 * Resolve request timeout and retry count for every client construction
 * path, including raw header mode, so `LISTMONK_TIMEOUT`/`LISTMONK_RETRIES`
 * behave the same for the CLI and the MCP server. An explicit value wins and
 * leaves its environment variable unread; environment values are validated
 * strictly.
 */
export function resolveListmonkTransportOptions(explicit?: {
	timeout?: number;
	retries?: number;
}): { timeout: number; retries: number } {
	return {
		timeout:
			explicit?.timeout ?? readTimeoutEnvironment() ?? DEFAULT_CONFIG.timeout,
		retries:
			explicit?.retries ?? readRetriesEnvironment() ?? DEFAULT_CONFIG.retries,
	};
}

/**
 * Creates a configuration object from environment variables and overrides.
 *
 * Explicit `auth` is used as given: an empty username or token is never
 * completed from `LISTMONK_USERNAME`/`LISTMONK_API_TOKEN`, because those
 * credentials belong to the environment's server, not to an explicitly
 * configured one.
 */
export const createConfig = (
	overrides?: Partial<ListmonkConfig>,
): ListmonkConfig => {
	const env = readEnvironment();

	const explicitAuth = overrides?.auth;

	// Merge with overrides.
	const config: ListmonkConfig = {
		baseUrl: overrides?.baseUrl || env.LISTMONK_API_URL || DEFAULT_CONFIG.baseUrl,
		auth: explicitAuth
			? {
					username: explicitAuth.username ?? "",
					token: explicitAuth.token ?? "",
				}
			: {
					username: env.LISTMONK_USERNAME || DEFAULT_CONFIG.auth.username,
					token: env.LISTMONK_API_TOKEN || DEFAULT_CONFIG.auth.token,
				},
		...resolveListmonkTransportOptions(overrides),
		headers: {
			...DEFAULT_CONFIG.headers,
			...overrides?.headers,
		},
	};

	return config;
};

/**
 * Validates that required configuration is present
 */
export const validateConfig = (config: ListmonkConfig): void => {
	if (!config.baseUrl) {
		throw new Error("baseUrl is required in Listmonk configuration");
	}

	if (!config.auth.username) {
		throw new Error("auth.username is required in Listmonk configuration");
	}

	if (!config.auth.token) {
		throw new Error(
			"auth.token is required in Listmonk configuration. Pass auth.token explicitly, or omit auth and set the LISTMONK_API_TOKEN environment variable.",
		);
	}

	// Validate URL format
	try {
		new URL(config.baseUrl);
	} catch {
		throw new Error(`Invalid baseUrl: ${config.baseUrl}`);
	}
};

/**
 * Converts configuration to headers for HTTP requests
 */
export const configToHeaders = (
	config: ListmonkConfig,
): Record<string, string> => {
	return {
		"Content-Type": "application/json",
		Authorization: `token ${config.auth.username}:${config.auth.token}`,
		...config.headers,
	};
};
