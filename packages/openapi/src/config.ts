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
	LISTMONK_URL?: string;
	LISTMONK_USERNAME?: string;
	LISTMONK_TOKEN?: string;
	LISTMONK_TIMEOUT?: string;
	LISTMONK_RETRIES?: string;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG = {
	baseUrl: 'http://localhost:9000/api',
	auth: {
		username: 'api-admin',
		token: '',
	},
	timeout: 30000,
	retries: 3,
	headers: {},
} as const;

/**
 * Creates a configuration object from environment variables and overrides
 */
export const createConfig = (overrides?: Partial<ListmonkConfig>): ListmonkConfig => {
	// Get environment variables (works with Bun, Node.js, etc.)
	const env: EnvConfig = {
		LISTMONK_URL: process.env.LISTMONK_URL,
		LISTMONK_USERNAME: process.env.LISTMONK_USERNAME,
		LISTMONK_TOKEN: process.env.LISTMONK_TOKEN,
		LISTMONK_TIMEOUT: process.env.LISTMONK_TIMEOUT,
		LISTMONK_RETRIES: process.env.LISTMONK_RETRIES,
	};

	// Build config from environment variables
	const envConfig: Partial<ListmonkConfig> = {
		baseUrl: env.LISTMONK_URL || DEFAULT_CONFIG.baseUrl,
		auth: {
			username: env.LISTMONK_USERNAME || DEFAULT_CONFIG.auth.username,
			token: env.LISTMONK_TOKEN || DEFAULT_CONFIG.auth.token,
		},
		timeout: env.LISTMONK_TIMEOUT ? parseInt(env.LISTMONK_TIMEOUT, 10) : DEFAULT_CONFIG.timeout,
		retries: env.LISTMONK_RETRIES ? parseInt(env.LISTMONK_RETRIES, 10) : DEFAULT_CONFIG.retries,
		headers: DEFAULT_CONFIG.headers,
	};

	// Merge with overrides
	const config: ListmonkConfig = {
		baseUrl: overrides?.baseUrl || envConfig.baseUrl || DEFAULT_CONFIG.baseUrl,
		auth: {
			username: overrides?.auth?.username || envConfig.auth?.username || DEFAULT_CONFIG.auth.username,
			token: overrides?.auth?.token || envConfig.auth?.token || DEFAULT_CONFIG.auth.token,
		},
		timeout: overrides?.timeout || envConfig.timeout || DEFAULT_CONFIG.timeout,
		retries: overrides?.retries || envConfig.retries || DEFAULT_CONFIG.retries,
		headers: {
			...DEFAULT_CONFIG.headers,
			...envConfig.headers,
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
		throw new Error('baseUrl is required in Listmonk configuration');
	}

	if (!config.auth.username) {
		throw new Error('auth.username is required in Listmonk configuration');
	}

	if (!config.auth.token) {
		throw new Error('auth.token is required in Listmonk configuration. Set LISTMONK_TOKEN environment variable or pass it in config.');
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
export const configToHeaders = (config: ListmonkConfig): Record<string, string> => {
	return {
		'Content-Type': 'application/json',
		'Authorization': `token ${config.auth.username}:${config.auth.token}`,
		...config.headers,
	};
};
