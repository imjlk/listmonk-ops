import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import {
	campaignOperations,
	createCampaignOperation,
	getCampaignOperationByMcpName,
	getMediaOperationByMcpName,
	invokeGetCampaignsOperation,
	invokeGetMediaFileOperation,
	invokeGetMediaOperation,
	invokeCampaignOperationByMcpName,
	invokeCancelCampaignOperation,
	invokeCloneCampaignOperation,
	invokeDeleteMediaOperation,
	invokeGetCampaignStatsOperation,
	invokeMediaOperationByMcpName,
	invokeCreateSubscriberOperation,
	invokeCreateTemplateOperation,
	invokeGetTemplatesOperation,
	invokePauseCampaignOperation,
	invokeScheduleCampaignOperation,
	invokeSetDefaultTemplateOperation,
	invokeStartCampaignOperation,
	invokeUpdateCampaignOperation,
	invokeUpdateSubscriberOperation,
	invokeUpdateTemplateOperation,
	subscriberOperations,
	mediaOperations,
	templateOperations,
	OperationInputError,
} from "../src";

type CampaignClient = Pick<ListmonkClient, "campaign">;
type SubscriberClient = Pick<ListmonkClient, "subscriber">;
type TemplateClient = Pick<ListmonkClient, "template">;
type MediaClient = Pick<ListmonkClient, "media">;

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

function mediaContext(methods: Partial<MediaClient["media"]>): {
	client: MediaClient;
} {
	return { client: { media: methods } as MediaClient };
}

describe("shared CRUD resource operations", () => {
	test("exposes object-root registries with safety metadata", () => {
		expect(campaignOperations).toHaveLength(11);
		expect(subscriberOperations).toHaveLength(5);
		expect(templateOperations).toHaveLength(6);
		expect(mediaOperations).toHaveLength(3);
		for (const operation of [
			...campaignOperations,
			...subscriberOperations,
			...templateOperations,
			...mediaOperations,
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
			)?.safety,
		).toEqual({
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: true,
		});
		expect(mediaOperations[2]?.safety.destructiveHint).toBe(true);
		expect(
			getCampaignOperationByMcpName("listmonk_update_campaign"),
		).toBe(campaignOperations[3]);
		expect(getMediaOperationByMcpName("listmonk_delete_media")).toBe(
			mediaOperations[2],
		);
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

	test("applies media pagination locally and invokes named media operations", async () => {
		const list = mock(async () => ({
			data: {
				results: [
					{ id: 1, filename: "first.png" },
					{ id: 2, filename: "second.png" },
					{ id: 3, filename: "third.png" },
				],
				total: 3,
				per_page: 3,
				page: 1,
			},
		}));

		await expect(
			invokeGetMediaOperation(
				mediaContext({ list: list as MediaClient["media"]["list"] }),
				{ page: "2", per_page: "1" },
			),
		).resolves.toEqual({
			results: [{ id: 2, filename: "second.png" }],
			total: 3,
			per_page: 1,
			page: 2,
		});
		expect(list).toHaveBeenCalledTimes(1);

		const getById = mock(async () => ({
			data: { id: 12, filename: "selected.png" },
		}));
		await expect(
			invokeGetMediaFileOperation(
				mediaContext({
					getById: getById as MediaClient["media"]["getById"],
				}),
				{ id: "12" },
			),
		).resolves.toMatchObject({ id: 12, filename: "selected.png" });
		expect(getById).toHaveBeenCalledWith({ path: { id: 12 } });

		const deleteById = mock(async () => ({ data: true }));
		await expect(
			invokeDeleteMediaOperation(
				mediaContext({
					deleteById: deleteById as MediaClient["media"]["deleteById"],
				}),
				{ id: "12" },
			),
		).resolves.toEqual({ id: 12, deleted: true });
		expect(deleteById).toHaveBeenCalledWith({ path: { id: 12 } });
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
		await expect(
			invokeMediaOperationByMcpName(mediaContext({}), "unknown", {}),
		).resolves.toBeUndefined();
	});

	test("validates campaign lifecycle state transitions before updating status", async () => {
		const updateStatus = mock(async () => ({ data: true })) as unknown as CampaignClient["campaign"]["updateStatus"];
		const update = mock(async () => ({ data: {} })) as unknown as CampaignClient["campaign"]["update"];

		// schedule: draft -> scheduled allowed when send_at is provided
		const getById = mock(async () => ({
			data: { id: 10, name: "Draft", status: "draft" },
		})) as unknown as CampaignClient["campaign"]["getById"];
		const scheduleResult = await invokeScheduleCampaignOperation(
			campaignContext({
				getById,
				update: update as CampaignClient["campaign"]["update"],
				updateStatus,
			}),
			{ id: 10, send_at: "2026-08-01T09:00:00Z" },
		);
		expect(scheduleResult).toEqual({ id: 10, status: "scheduled" });
		expect(updateStatus).toHaveBeenCalledWith({
			path: { id: 10 },
			body: { status: "scheduled" },
		});

		// start: scheduled -> running allowed
		const startResult = await invokeStartCampaignOperation(
			campaignContext({
				getById: mock(async () => ({
					data: { id: 10, status: "scheduled" },
				})) as unknown as CampaignClient["campaign"]["getById"],
				updateStatus: mock(async () => ({ data: true })) as unknown as CampaignClient["campaign"]["updateStatus"],
			}),
			{ id: 10 },
		);
		expect(startResult).toEqual({ id: 10, status: "running" });
	});

	test("rejects invalid campaign lifecycle transitions", async () => {
		const updateStatus = mock(async () => ({ data: true })) as unknown as CampaignClient["campaign"]["updateStatus"];
		const getById = mock(async () => ({
			data: { id: 10, status: "finished" },
		})) as unknown as CampaignClient["campaign"]["getById"];

		// finished is terminal — any transition is rejected before the API call
		await expect(
			invokeStartCampaignOperation(
				campaignContext({ getById, updateStatus }),
				{ id: 10 },
			),
		).rejects.toThrow(/transition/i);
		expect(updateStatus).not.toHaveBeenCalled();
	});

	test("rejects malformed schedule send_at before any API call", async () => {
		const update = mock(async () => ({ data: {} })) as unknown as CampaignClient["campaign"]["update"];
		const updateStatus = mock(async () => ({ data: true })) as unknown as CampaignClient["campaign"]["updateStatus"];
		const getById = mock(async () => ({
			data: { id: 10, status: "draft" },
		})) as unknown as CampaignClient["campaign"]["getById"];

		for (const malformed of [
			"tomorrow",
			"abc",
			"next week",
			"2026",
			// Structurally matches ISO 8601 but contains impossible components.
			"2026-13-45T25:61:61Z",
			"0000-00-00 00:00:00",
		]) {
			await expect(
				invokeScheduleCampaignOperation(
					campaignContext({ getById, update, updateStatus }),
					{ id: 10, send_at: malformed },
				),
			).rejects.toEqual(
				expect.objectContaining<Partial<OperationInputError>>({
					name: "OperationInputError",
				}),
			);
		}
		expect(update).not.toHaveBeenCalled();
		expect(updateStatus).not.toHaveBeenCalled();
	});

	test("clones a campaign by copying its body and resetting runtime fields", async () => {
		const getById = mock(async () => ({
			data: {
				id: 7,
				name: "Source",
				status: "finished",
				body: "<p>Hi</p>",
				subject: "Subject",
				from_email: "sender@example.com",
				type: "regular",
				content_type: "html",
				messenger: "email",
				tags: ["newsletter"],
				template_id: 3,
				lists: [{ id: 1 }],
				views: 100,
				clicks: 20,
			},
		})) as unknown as CampaignClient["campaign"]["getById"];
		const create = mock(async () => ({
			data: { id: 11, name: "Cloned", status: "draft" },
		})) as unknown as CampaignClient["campaign"]["create"];

		const cloned = await invokeCloneCampaignOperation(
			campaignContext({ getById, create }),
			{ id: 7, name: "Cloned" },
		);
		expect(cloned).toMatchObject({ id: 11, name: "Cloned" });
		// The clone must not carry over the source identity or stats fields.
		expect(create).toHaveBeenCalledWith({
			body: expect.not.objectContaining({
				id: 7,
				uuid: expect.anything(),
				views: expect.anything(),
				clicks: expect.anything(),
			}),
		});
	});

	test("reads campaign stats through the shared operation", async () => {
		const getById = mock(async () => ({
			data: {
				id: 10,
				status: "running",
				views: 1000,
				clicks: 200,
				bounces: 5,
				to_send: 5000,
				sent: 3000,
				started_at: "2026-07-26T10:00:00Z",
			},
		})) as unknown as CampaignClient["campaign"]["getById"];

		const stats = await invokeGetCampaignStatsOperation(
			campaignContext({ getById }),
			{ id: 10 },
		);
		expect(stats).toEqual({
			id: 10,
			status: "running",
			views: 1000,
			clicks: 200,
			bounces: 5,
			to_send: 5000,
			sent: 3000,
			started_at: "2026-07-26T10:00:00Z",
		});
		expect(getById).toHaveBeenCalledWith({ path: { id: 10 } });
	});

	test("pause and cancel dispatch through the lifecycle invokers", async () => {
		const getById = mock(async ({ path }: { path: { id: number } }) => ({
			data: { id: path.id, status: path.id === 1 ? "running" : "scheduled" },
		})) as unknown as CampaignClient["campaign"]["getById"];
		const updateStatus = mock(async () => ({ data: true })) as unknown as CampaignClient["campaign"]["updateStatus"];

		const paused = await invokePauseCampaignOperation(
			campaignContext({ getById, updateStatus }),
			{ id: 1 },
		);
		expect(paused).toEqual({ id: 1, status: "paused" });

		const cancelled = await invokeCancelCampaignOperation(
			campaignContext({ getById, updateStatus }),
			{ id: 2 },
		);
		expect(cancelled).toEqual({ id: 2, status: "cancelled" });
	});
});
