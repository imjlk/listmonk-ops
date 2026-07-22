import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import {
	campaignOperations,
	createCampaignOperation,
	getCampaignOperationByMcpName,
	invokeGetCampaignsOperation,
	invokeCampaignOperationByMcpName,
	invokeCreateSubscriberOperation,
	invokeCreateTemplateOperation,
	invokeGetTemplatesOperation,
	invokeSetDefaultTemplateOperation,
	invokeUpdateCampaignOperation,
	invokeUpdateSubscriberOperation,
	invokeUpdateTemplateOperation,
	subscriberOperations,
	templateOperations,
	OperationInputError,
} from "../src";

type CampaignClient = Pick<ListmonkClient, "campaign">;
type SubscriberClient = Pick<ListmonkClient, "subscriber">;
type TemplateClient = Pick<ListmonkClient, "template">;

function campaignContext(
	methods: Partial<CampaignClient["campaign"]>,
): { client: CampaignClient } {
	return { client: { campaign: methods } as CampaignClient };
}

function subscriberContext(
	methods: Partial<SubscriberClient["subscriber"]>,
): { client: SubscriberClient } {
	return { client: { subscriber: methods } as SubscriberClient };
}

function templateContext(
	methods: Partial<TemplateClient["template"]>,
): { client: TemplateClient } {
	return { client: { template: methods } as TemplateClient };
}

describe("shared CRUD resource operations", () => {
	test("exposes object-root registries with safety metadata", () => {
		expect(campaignOperations).toHaveLength(5);
		expect(subscriberOperations).toHaveLength(5);
		expect(templateOperations).toHaveLength(6);
		for (const operation of [
			...campaignOperations,
			...subscriberOperations,
			...templateOperations,
		]) {
			expect(operation.inputJsonSchema.type).toBe("object");
			expect(operation.outputJsonSchema.type).toBe("object");
		}
		expect(campaignOperations[0]?.safety.readOnlyHint).toBe(true);
		expect(campaignOperations[2]?.safety.idempotentHint).toBe(false);
		expect(campaignOperations[4]?.safety.destructiveHint).toBe(true);
		expect(
		templateOperations.find(
			(operation) => operation.id === "templates.set-default",
		)?.safety.destructiveHint,
	).toBe(true);
		expect(
			getCampaignOperationByMcpName("listmonk_update_campaign"),
		).toBe(campaignOperations[3]);
	});

	test("dispatches campaign list inputs through the named operation", async () => {
		const list = mock(async () => ({
			data: { results: [{ id: 7, name: "Newsletter" }], total: 1 },
		}));
		const invocation = await invokeCampaignOperationByMcpName(
			campaignContext({ list: list as CampaignClient["campaign"]["list"] }),
			"listmonk_get_campaigns",
			{ status: "scheduled", page: "2", per_page: "10" },
		);

		expect(invocation?.output).toMatchObject({
			results: [{ id: 7, name: "Newsletter" }],
			page: 2,
			per_page: 10,
		});
		expect(list).toHaveBeenCalledWith({
			query: { page: 2, per_page: 10, status: ["scheduled"] },
		});
		await invokeGetCampaignsOperation(
			campaignContext({ list: list as CampaignClient["campaign"]["list"] }),
			{ page: 1 },
		);
	});

	test("resolves campaigns and subscribers when create responses omit data", async () => {
		const createCampaign = mock(async () => ({ data: undefined }));
		const listCampaigns = mock(async () => ({
			data: { results: [{ id: 9, name: "Created campaign" }], total: 1 },
		}));
		const campaign = await invokeCampaignOperationByMcpName(
			campaignContext({
				create: createCampaign as CampaignClient["campaign"]["create"],
				list: listCampaigns as CampaignClient["campaign"]["list"],
			}),
			"listmonk_create_campaign",
			{
				name: "Created campaign",
				subject: "Subject",
				from_email: "sender@example.com",
				body: "<p>Hello</p>",
				template_id: "3",
				lists: ["4"],
			},
		);
		expect(campaign.output).toMatchObject({ id: 9, name: "Created campaign" });

		const createSubscriber = mock(async () => ({ data: undefined }));
		const listSubscribers = mock(async () => ({
			data: { results: [{ id: 11, email: "created@example.com" }], total: 1 },
		}));
		const subscriber = await invokeCreateSubscriberOperation(
			subscriberContext({
				create: createSubscriber as SubscriberClient["subscriber"]["create"],
				list: listSubscribers as SubscriberClient["subscriber"]["list"],
			}),
			{ email: "created@example.com", name: "Created" },
		);
		expect(subscriber).toMatchObject({ id: 11, email: "created@example.com" });
	});

	test("searches later pages when resolving created subscribers and templates", async () => {
		const createSubscriber = mock(async () => ({ data: undefined }));
		const listSubscribers = mock(async ({ query }: { query?: Record<string, unknown> }) => ({
			data:
				query?.page === 2
					? { results: [{ id: 11, email: "created@example.com" }], total: 101, per_page: 100, page: 2 }
					: { results: [], total: 101, per_page: 100, page: 1 },
		}));
		await expect(
			invokeCreateSubscriberOperation(
				subscriberContext({
					create: createSubscriber as SubscriberClient["subscriber"]["create"],
					list: listSubscribers as SubscriberClient["subscriber"]["list"],
				}),
				{ email: "created@example.com", name: "Created" },
			),
		).resolves.toMatchObject({ id: 11 });
		expect(listSubscribers).toHaveBeenCalledTimes(2);
		expect(listSubscribers).toHaveBeenNthCalledWith(1, {
			query: { page: 1, per_page: 100 },
		});
		expect(listSubscribers).toHaveBeenNthCalledWith(2, {
			query: { page: 2, per_page: 100 },
		});

		const createTemplate = mock(async () => ({ data: undefined }));
		const listTemplates = mock(async ({ query }: { query?: Record<string, unknown> } = {}) => ({
			data:
				query?.page === 2
					? { results: [{ id: 12, name: "Created template" }], total: 2, per_page: 1, page: 2 }
					: { results: [], total: 2, per_page: 1, page: 1 },
		}));
		await expect(
			invokeCreateTemplateOperation(
				templateContext({
					create: createTemplate as TemplateClient["template"]["create"],
					list: listTemplates as TemplateClient["template"]["list"],
				}),
				{ name: "Created template", type: "campaign", body: "<p>Created</p>" },
			),
		).resolves.toMatchObject({ id: 12 });
		expect(listTemplates).toHaveBeenCalledTimes(2);
	});

	test("applies template pagination locally for the normalized response", async () => {
		const list = mock(async () => ({
			data: {
				results: [
					{ id: 1, name: "First" },
					{ id: 2, name: "Second" },
					{ id: 3, name: "Third" },
				],
				total: 3,
				per_page: 3,
				page: 1,
			},
		}));

		await expect(
			invokeGetTemplatesOperation(
				templateContext({
					list: list as TemplateClient["template"]["list"],
				}),
				{ page: "2", per_page: "1" },
			),
		).resolves.toEqual({
			results: [{ id: 2, name: "Second" }],
			total: 3,
			per_page: 1,
			page: 2,
		});
	});

	test("rejects empty subscriber and campaign updates before API calls", async () => {
		const campaignUpdate = mock(async () => ({ data: {} }));
		await expect(
			invokeUpdateCampaignOperation(
				campaignContext({
					update: campaignUpdate as CampaignClient["campaign"]["update"],
				}),
				{ id: 5 },
			),
		).rejects.toBeInstanceOf(OperationInputError);
		expect(campaignUpdate).not.toHaveBeenCalled();

		await expect(
			invokeUpdateSubscriberOperation(
				subscriberContext({
					update: campaignUpdate as SubscriberClient["subscriber"]["update"],
				}),
				{ id: 5 },
			),
		).rejects.toBeInstanceOf(OperationInputError);
		expect(campaignUpdate).not.toHaveBeenCalled();
	});

	test("merges current template fields before updating", async () => {
		const getById = mock(async () => ({
			data: {
				id: 12,
				name: "Existing",
				type: "campaign",
				body: "<p>Old</p>",
				subject: "Old subject",
			},
		}));
		const update = mock(async () => ({
			data: { id: 12, name: "Existing", type: "campaign", body: "<p>New</p>" },
		}));

		const output = await invokeUpdateTemplateOperation(
			templateContext({
				getById: getById as TemplateClient["template"]["getById"],
				update: update as TemplateClient["template"]["update"],
			}),
			{ id: "12", body: "<p>New</p>" },
		);

		expect(output).toMatchObject({ id: 12, body: "<p>New</p>" });
		expect(update).toHaveBeenCalledWith({
			path: { id: 12 },
			body: {
				name: "Existing",
				type: "campaign",
				subject: "Old subject",
				body: "<p>New</p>",
				body_source: undefined,
			},
		});
	});

	test("sets a default template through the named shared operation", async () => {
		const setAsDefault = mock(async () => ({
			data: [],
		}));

		await expect(
			invokeSetDefaultTemplateOperation(
				templateContext({
					setAsDefault: setAsDefault as TemplateClient["template"]["setAsDefault"],
				}),
				{ id: "12" },
			),
		).resolves.toEqual({ id: 12, set_default: true });
		expect(setAsDefault).toHaveBeenCalledWith({ path: { id: 12 } });
	});

	test("returns undefined for unknown resource operation names", async () => {
		await expect(
			invokeCampaignOperationByMcpName(campaignContext({}), "unknown", {}),
		).resolves.toBeUndefined();
	});
});
