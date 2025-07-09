/**
 * Listmonk TypeScript Client
 *
 * A fully type-safe TypeScript client for the Listmonk newsletter and mailing list manager API.
 * Features automatic response flattening, complete type safety, and excellent developer experience.
 */

// Client imports
import type { Campaign, List, Subscriber } from "./src/client/index";
import {
	createClient,
	createListmonkClient,
	createListmonkClientFromEnv,
	rawSdk,
	transformResponse,
} from "./src/client/index";

// Configuration imports
import type { ListmonkConfig } from "./src/config";
import { configToHeaders, createConfig, validateConfig } from "./src/config";

// Error handling imports
import {
	AuthenticationError,
	createErrorFromResponse,
	isListmonkError,
	ListmonkError,
	NotFoundError,
	RateLimitError,
	ServerError,
	ValidationError,
} from "./src/errors";

// Transform utility imports
import { transformResponseSync } from "./src/transform";

// === EXPORTS ===

// Main client exports
export {
	createListmonkClient,
	createListmonkClientFromEnv,
	createClient,
	rawSdk,
	transformResponse,
};

// Type exports
export type { List, Subscriber, Campaign, ListmonkConfig };

// Configuration exports
export { createConfig, validateConfig, configToHeaders };

// Transform utility exports
export { transformResponseSync };

// Error handling exports
export {
	ListmonkError,
	AuthenticationError,
	ValidationError,
	NotFoundError,
	RateLimitError,
	ServerError,
	createErrorFromResponse,
	isListmonkError,
};

// Generated exports (for advanced use cases)
export * as GeneratedSDK from "./generated/sdk.gen";
export type * as GeneratedTypes from "./generated/types.gen";
