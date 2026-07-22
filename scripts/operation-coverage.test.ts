import { describe, test } from "bun:test";
import {
	assertAbTestOperationsPublished,
	assertCampaignOperationsPublished,
	assertListOperationsPublished,
	assertOpsOperationsPublished,
	assertSubscriberOperationsPublished,
	assertTemplateOperationsPublished,
	assertTransactionalOperationsPublished,
} from "./shared-operation-coverage";

describe("shared operation coverage", () => {
	test("publishes every registered operation through its MCP tool family", () => {
		assertListOperationsPublished();
		assertCampaignOperationsPublished();
		assertSubscriberOperationsPublished();
		assertTemplateOperationsPublished();
		assertTransactionalOperationsPublished();
		assertOpsOperationsPublished();
		assertAbTestOperationsPublished();
	});
});
