/**
 * Listmonk TypeScript Client
 *
 * A fully type-safe TypeScript client for the Listmonk newsletter and mailing list manager API.
 * Features automatic response flattening, complete type safety, and excellent developer experience.
 */

// ===== IMPORTS =====

import type { ListmonkClient } from "./src/client/index";
// Client imports
import { createListmonkClient } from "./src/client/index";

// Configuration imports
import type { ListmonkConfig } from "./src/config";


// ===== EXPORTS =====

/**
 * Main client function
 */
export { createListmonkClient };

/**
 * Core types
 */
export type { ListmonkClient, ListmonkConfig };

/**
 * Core entity types
 */
export type {
	Campaign,
	List,
	Subscriber,
	Template,
} from "./src/client/index";
