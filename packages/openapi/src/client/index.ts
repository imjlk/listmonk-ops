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
	CampaignOperations,
	List,
	ListmonkClient,
	MediaOperations,
	Subscriber,
	SubscriberOperations,
	Template,
	TemplateOperations,
	UserRole,
	UserRoleInput,
	UserRoleOperations,
} from "./contracts";
export {
	createClient,
	createListmonkClient,
	createListmonkClientFromEnv,
} from "./factory";
export { transformResponse } from "./response";
