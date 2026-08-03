/**
 * Listmonk TypeScript Client
 *
 * A fully type-safe TypeScript client for the Listmonk newsletter and mailing list manager API.
 * Features automatic response flattening, complete type safety, and excellent developer experience.
 */

// ===== IMPORTS =====

import type {
	About,
	Campaign,
	List,
	ListmonkClient,
	Subscriber,
	Template,
	UserRole,
	UserRoleInput,
	UserRoleOperations,
} from "./src/client/index";
// Client imports
import {
	createClient,
	createListmonkClient,
	createListmonkClientFromEnv,
	transformResponse,
} from "./src/client/index";

// Configuration imports
import type { ListmonkConfig } from "./src/config";

// ===== EXPORTS =====

/**
 * Main client function
 */
export {
	createClient,
	createListmonkClient,
	createListmonkClientFromEnv,
	transformResponse,
};

/**
 * Core types
 */
export type {
	ListmonkClient,
	ListmonkConfig,
	UserRole,
	UserRoleInput,
	UserRoleOperations,
};

/**
 * Core entity types
 */
export type { About, Campaign, List, Subscriber, Template };
