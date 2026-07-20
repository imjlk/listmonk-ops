/**
 * Handwritten Listmonk client facade.
 *
 * Keep this module limited to the stable public surface. Named internal
 * factories live in sibling modules so the compiler graph can expose their
 * dependencies and direct tests without pulling generated SDK files into the
 * main project graph.
 */

export type {
	About,
	Campaign,
	List,
	ListmonkClient,
	Subscriber,
	Template,
} from "./contracts";
export {
	createClient,
	createListmonkClient,
	createListmonkClientFromEnv,
	rawSdk,
} from "./factory";
export { transformResponse } from "./response";
