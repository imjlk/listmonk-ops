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
	invokeUploadMediaOperation,
	invokeAddSubscribersToListsOperation,
	invokeBlocklistSubscribersOperation,
	invokeCreateSubscriberOperation,
	invokeCreateTemplateOperation,
	invokeGetTemplatesOperation,
	invokePauseCampaignOperation,
	invokeRemoveSubscribersFromListsOperation,
	invokeScheduleCampaignOperation,
	invokeSetDefaultTemplateOperation,
	invokeStartCampaignOperation,
	invokeUnblocklistSubscribersOperation,
	invokeUpdateCampaignOperation,
	invokeUpdateSubscriberOperation,
	invokeUpdateTemplateOperation,
	subscriberOperations,
	mediaOperations,
	ensureTemplate,
	reconcileTemplate,
	reconcileTemplateManifest,
	TemplateManifestApplyError,
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
	test("plans then applies an exact-name template update", async () => {
		const list = mock(async () => ({
			data: {
				results: [
					{
						id: 9,
						name: "Account sign-in code",
						type: "tx",
						subject: "Sign-in code",
						body: "<p>Old</p>",
					},
				],
				total: 1,
			},
		}));
		const getById = mock(async () => ({
			data: {
				id: 9,
				name: "Account sign-in code",
				type: "tx",
				subject: "Sign-in code",
				body: "<p>Old</p>",
			},
		}));
		const update = mock(async ({ body }: { body: Record<string, unknown> }) => ({
			data: { id: 9, ...body },
		}));
		const result = await reconcileTemplate(
			templateContext({
				list: list as TemplateClient["template"]["list"],
				getById: getById as TemplateClient["template"]["getById"],
				update: update as TemplateClient["template"]["update"],
			}),
			{
				name: "Account sign-in code",
				type: "tx",
				subject: "Sign-in code",
				body: "<p>{{ .Tx.Data.otp }}</p>",
			},
		);
		expect(result).toMatchObject({
			action: "update",
			applied: false,
			template: { id: 9, body: "<p>Old</p>" },
		});
		expect(list).toHaveBeenCalledTimes(1);
		expect(update).not.toHaveBeenCalled();

		await expect(
			ensureTemplate(
				templateContext({
					list: list as TemplateClient["template"]["list"],
					getById: getById as TemplateClient["template"]["getById"],
					update: update as TemplateClient["template"]["update"],
				}),
				{
					name: "Account sign-in code",
					type: "tx",
					subject: "Sign-in code",
					body: "<p>{{ .Tx.Data.otp }}</p>",
				},
			),
		).resolves.toMatchObject({
			action: "update",
			applied: true,
			template: { id: 9, body: "<p>{{ .Tx.Data.otp }}</p>" },
		});
		expect(update).toHaveBeenCalledTimes(1);
	});

	test("plans a missing template, then ensures it and preserves exact matches", async () => {
		const create = mock(async ({ body }: { body: Record<string, unknown> }) => ({
			data: { id: 12, ...body },
		}));
		const missing = mock(async () => ({ data: { results: [], total: 0 } }));
		await expect(
			reconcileTemplate(
				templateContext({
					list: missing as TemplateClient["template"]["list"],
					create: create as TemplateClient["template"]["create"],
				}),
				{ name: "Account sign-in code", type: "tx", body: "<p>OTP</p>" },
			),
		).resolves.toEqual({
			name: "Account sign-in code",
			action: "create",
			applied: false,
		});
		expect(create).not.toHaveBeenCalled();

		await expect(
			ensureTemplate(
				templateContext({
					list: missing as TemplateClient["template"]["list"],
					create: create as TemplateClient["template"]["create"],
				}),
				{ name: "Account sign-in code", type: "tx", body: "<p>OTP</p>" },
			),
		).resolves.toMatchObject({
			action: "create",
			applied: true,
			template: { id: 12 },
		});

		const matching = mock(async () => ({
			data: {
				results: [
					{
						id: 12,
						name: "Account sign-in code",
					},
				],
				total: 1,
			},
		}));
		const getById = mock(async () => ({
			data: {
				id: 12,
				name: "Account sign-in code",
				type: "tx",
				subject: "",
				body: "<p>OTP</p>",
				body_source: "preserved remote source",
			},
		}));
		await expect(
			reconcileTemplate(
				templateContext({
					list: matching as TemplateClient["template"]["list"],
					getById: getById as TemplateClient["template"]["getById"],
				}),
				{ name: "Account sign-in code", type: "tx", body: "<p>OTP</p>" },
			),
		).resolves.toMatchObject({
			action: "unchanged",
			applied: false,
			template: { id: 12 },
		});
	});

	test("plans a complete versioned manifest before applying mutations", async () => {
		const list = mock(async () => ({ data: { results: [], total: 0 } }));
		const create = mock(async ({ body }: { body: Record<string, unknown> }) => ({
			data: { id: 20, ...body },
		}));
		const context = templateContext({
			list: list as TemplateClient["template"]["list"],
			create: create as TemplateClient["template"]["create"],
		});
		const manifest = {
			schema_version: 1 as const,
			templates: [
				{ name: "Account sign-in code", type: "tx" as const, body: "<p>OTP</p>" },
				{ name: "Password reset code", type: "tx" as const, body: "<p>Reset</p>" },
			],
		};

		await expect(reconcileTemplateManifest(context, manifest)).resolves.toEqual({
			schema_version: 1,
			apply: false,
			results: [
				{ name: "Account sign-in code", action: "create", applied: false },
				{ name: "Password reset code", action: "create", applied: false },
			],
		});
		expect(list).toHaveBeenCalledTimes(1);
		expect(create).not.toHaveBeenCalled();

		await expect(
			reconcileTemplateManifest(context, {
				schema_version: 1,
				templates: [
					{ name: "Duplicate", body: "<p>First</p>" },
					{ name: "Duplicate", body: "<p>Second</p>" },
				],
			}),
		).rejects.toThrow("duplicate name");
	});

	test("reports partial manifest results when a remote apply fails", async () => {
		const list = mock(async () => ({ data: { results: [], total: 0 } }));
		const create = mock(async ({ body }: { body: Record<string, unknown> }) => {
			if (body.name === "Password reset code") {
				throw new Error("remote create failed");
			}
			return { data: { id: 20, ...body } };
		});
		let failure: unknown;
		try {
			await reconcileTemplateManifest(
				templateContext({
					list: list as TemplateClient["template"]["list"],
					create: create as TemplateClient["template"]["create"],
				}),
				{
					schema_version: 1,
					templates: [
						{ name: "Account sign-in code", type: "tx", body: "<p>OTP</p>" },
						{ name: "Password reset code", type: "tx", body: "<p>Reset</p>" },
					],
				},
				{ apply: true },
			);
		} catch (error) {
			failure = error;
		}

		expect(failure).toBeInstanceOf(TemplateManifestApplyError);
		const manifestError = failure as TemplateManifestApplyError;
		expect(manifestError.failedTemplate).toBe("Password reset code");
		expect(manifestError.appliedResults).toEqual([
			expect.objectContaining({
				name: "Account sign-in code",
				action: "create",
				applied: true,
			}),
		]);
		expect(create).toHaveBeenCalledTimes(2);
	});

	test("fails closed when exact-name template reconciliation is ambiguous", async () => {
		const list = mock(async () => ({
			data: {
				results: [
					{ id: 9, name: "Account sign-in code" },
					{ id: 10, name: "Account sign-in code" },
				],
				total: 2,
			},
		}));
		await expect(
			reconcileTemplate(
				templateContext({
					list: list as TemplateClient["template"]["list"],
				}),
				{ name: "Account sign-in code", type: "tx", body: "<p>OTP</p>" },
			),
		).rejects.toThrow("ambiguous");
	});

	test("exposes object-root registries with safety metadata", () => {
		expect(campaignOperations).toHaveLength(11);
		expect(subscriberOperations).toHaveLength(9);
		expect(templateOperations).toHaveLength(6);
		expect(mediaOperations).toHaveLength(4);
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
			"2025-02-29T09:00:00Z",
			"2026-02-30 09:00:00",
			"2026-04-31T09:00:00Z",
			// Timezone offset out of range — the regex would accept these
			// without an explicit offset-range check.
			"2026-08-01T09:00:00+99:99",
			"2026-08-01T09:00:00-23:60",
			// `-00:00` carries the RFC 3339 "offset unknown" meaning and is
			// rejected to keep the contract unambiguous. `+00:00` is valid.
			"2026-08-01T09:00:00-00:00",
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

	test("accepts ISO 8601 timestamps with fractional seconds", async () => {
		// `new Date().toISOString()` always emits milliseconds; the schedule
		// operation must accept that form so callers do not have to strip
		// the fractional component before scheduling.
		const update = mock(async () => ({ data: {} })) as unknown as CampaignClient["campaign"]["update"];
		const updateStatus = mock(async () => ({ data: true })) as unknown as CampaignClient["campaign"]["updateStatus"];
		const getById = mock(async () => ({
			data: { id: 10, status: "draft" },
		})) as unknown as CampaignClient["campaign"]["getById"];

		for (const ts of [
			"2026-08-01T09:00:00.000Z",
			"2026-08-01T09:00:00.123456Z",
			"2026-08-01T09:00:00.123456789Z",
			"2024-02-29T09:00:00Z",
			"2026-08-01 09:00:00",
			// `+00:00` is a valid UTC offset equivalent to `Z` per ISO 8601 /
			// RFC 3339. Postgres, Python datetime.isoformat(), and Go
			// time.RFC3339 all emit it, so it must round-trip.
			"2026-08-01T09:00:00+00:00",
			"2026-08-01T09:00:00.123+00:00",
			// Real signed offsets must work too.
			"2026-08-01T09:00:00+09:00",
			"2026-08-01T09:00:00+0900",
			"2026-08-01T09:00:00-05:00",
		]) {
			await expect(
				invokeScheduleCampaignOperation(
					campaignContext({ getById, update, updateStatus }),
					{ id: 10, send_at: ts },
				),
			).resolves.toEqual({ id: 10, status: "scheduled" });
		}
	});

	test("scheduling an already-scheduled campaign with the same send_at is a no-op", async () => {
		const update = mock(async () => ({ data: {} })) as unknown as CampaignClient["campaign"]["update"];
		const updateStatus = mock(async () => ({ data: true })) as unknown as CampaignClient["campaign"]["updateStatus"];
		const getById = mock(async () => ({
			data: { id: 10, status: "scheduled", send_at: "2026-08-01T09:00:00Z" },
		})) as unknown as CampaignClient["campaign"]["getById"];

		const result = await invokeScheduleCampaignOperation(
			campaignContext({ getById, update, updateStatus }),
			{ id: 10, send_at: "2026-08-01T09:00:00Z" },
		);
		expect(result).toEqual({ id: 10, status: "scheduled" });
		expect(update).not.toHaveBeenCalled();
		expect(updateStatus).not.toHaveBeenCalled();
	});

	test("a successful schedule retry ignores the pre-mutation revision token", async () => {
		const update = mock(async () => ({ data: {} })) as unknown as CampaignClient["campaign"]["update"];
		const updateStatus = mock(async () => ({ data: true })) as unknown as CampaignClient["campaign"]["updateStatus"];
		const getById = mock(async () => ({
			data: {
				id: 10,
				status: "scheduled",
				send_at: "2026-08-01T09:00:00Z",
				updated_at: "2026-07-30T10:00:00Z",
			},
		})) as unknown as CampaignClient["campaign"]["getById"];

		await expect(
			invokeScheduleCampaignOperation(
				campaignContext({ getById, update, updateStatus }),
				{
					id: 10,
					send_at: "2026-08-01T09:00:00Z",
					expected_updated_at: "2026-07-30T09:00:00Z",
				},
			),
		).resolves.toEqual({ id: 10, status: "scheduled" });
		expect(update).not.toHaveBeenCalled();
		expect(updateStatus).not.toHaveBeenCalled();
	});

	test("rescheduling an already-scheduled campaign updates send_at without calling updateStatus", async () => {
		const update = mock(async () => ({ data: {} })) as unknown as CampaignClient["campaign"]["update"];
		const updateStatus = mock(async () => ({ data: true })) as unknown as CampaignClient["campaign"]["updateStatus"];
		const getById = mock(async () => ({
			data: { id: 10, status: "scheduled", send_at: "2026-08-01T09:00:00Z" },
		})) as unknown as CampaignClient["campaign"]["getById"];

		const result = await invokeScheduleCampaignOperation(
			campaignContext({ getById, update, updateStatus }),
			{ id: 10, send_at: "2026-09-01T10:00:00Z" },
		);
		expect(result).toEqual({ id: 10, status: "scheduled" });
		expect(update).toHaveBeenCalledTimes(1);
		expect(update).toHaveBeenCalledWith({
			path: { id: 10 },
			body: { send_at: "2026-09-01T10:00:00Z" },
		});
		expect(updateStatus).not.toHaveBeenCalled();
	});

	test("scheduling from draft calls both update and updateStatus", async () => {
		const update = mock(async () => ({ data: {} })) as unknown as CampaignClient["campaign"]["update"];
		const updateStatus = mock(async () => ({ data: true })) as unknown as CampaignClient["campaign"]["updateStatus"];
		const getById = mock(async () => ({
			data: { id: 10, status: "draft", send_at: null },
		})) as unknown as CampaignClient["campaign"]["getById"];

		const result = await invokeScheduleCampaignOperation(
			campaignContext({ getById, update, updateStatus }),
			{ id: 10, send_at: "2026-08-01T09:00:00Z" },
		);
		expect(result).toEqual({ id: 10, status: "scheduled" });
		expect(update).toHaveBeenCalledTimes(1);
		expect(updateStatus).toHaveBeenCalledTimes(1);
		expect(updateStatus).toHaveBeenCalledWith({
			path: { id: 10 },
			body: { status: "scheduled" },
		});
	});

	test("rejects a campaign changed after preflight before scheduling", async () => {
		const update = mock(async () => ({ data: {} })) as unknown as CampaignClient["campaign"]["update"];
		const updateStatus = mock(async () => ({ data: true })) as unknown as CampaignClient["campaign"]["updateStatus"];
		const getById = mock(async () => ({
			data: {
				id: 10,
				status: "draft",
				send_at: null,
				updated_at: "2026-07-30T10:00:00Z",
			},
		})) as unknown as CampaignClient["campaign"]["getById"];

		await expect(
			invokeScheduleCampaignOperation(
				campaignContext({ getById, update, updateStatus }),
				{
					id: 10,
					send_at: "2026-08-01T09:00:00Z",
					expected_updated_at: "2026-07-30T09:00:00Z",
				},
			),
		).rejects.toThrow("changed after preflight");
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
				// Visual-editor source must survive cloning so the clone
				// stays editable in the visual builder.
				body_source: '{"blocks":[]}',
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
		// collectCampaignIdsByName scans existing same-name campaigns before
		// the create. Return an empty page so the snapshot is empty.
		const list = mock(async () => ({
			data: { results: [], total: 0, per_page: 100, page: 1 },
		})) as unknown as CampaignClient["campaign"]["list"];

		const cloned = await invokeCloneCampaignOperation(
			campaignContext({ getById, create, list }),
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
		// body_source must be forwarded so visual campaigns stay editable.
		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({
				body: expect.objectContaining({ body_source: '{"blocks":[]}' }),
			}),
		);
	});

	test("clones resolve to a non-source candidate when Listmonk omits the create body", async () => {
		// Listmonk accepts the create but returns no body. The name-based
		// fallback must skip the source campaign (same id) and return the
		// newly created clone.
		const sourceId = 7;
		const getById = mock(async () => ({
			data: {
				id: sourceId,
				name: "Source",
				status: "finished",
				body: "<p>Hi</p>",
				subject: "Subject",
				from_email: "sender@example.com",
				type: "regular",
				content_type: "html",
				messenger: "email",
				template_id: 3,
				lists: [{ id: 1 }],
			},
		})) as unknown as CampaignClient["campaign"]["getById"];
		const create = mock(async () => ({ data: undefined })) as unknown as CampaignClient["campaign"]["create"];
		// First list call (collectCampaignIdsByName, pre-create) returns an
		// empty page so the snapshot is empty. Second call (post-create
		// fallback) returns the newly created clone (id 11).
		let listCallCount = 0;
		const list = mock(async () => {
			listCallCount += 1;
			if (listCallCount === 1) {
				return {
					data: { results: [], total: 0, per_page: 100, page: 1 },
				};
			}
			return {
				data: {
					results: [{ id: 11, name: "Cloned" }],
					total: 1,
					per_page: 100,
					page: 1,
				},
			};
		}) as unknown as CampaignClient["campaign"]["list"];

		const cloned = await invokeCloneCampaignOperation(
			campaignContext({ getById, create, list }),
			{ id: sourceId, name: "Cloned" },
		);
		expect(cloned).toMatchObject({ id: 11, name: "Cloned" });
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
		// Listmonk 6.2.0 only accepts paused/cancelled from `running`.
		const getById = mock(async ({ path }: { path: { id: number } }) => ({
			data: { id: path.id, status: "running" },
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

	test("a successful lifecycle retry ignores the pre-mutation revision token", async () => {
		const getById = mock(async () => ({
			data: {
				id: 2,
				status: "cancelled",
				updated_at: "2026-07-30T10:00:00Z",
			},
		})) as unknown as CampaignClient["campaign"]["getById"];
		const updateStatus = mock(async () => ({ data: true })) as unknown as CampaignClient["campaign"]["updateStatus"];

		await expect(
			invokeCancelCampaignOperation(
				campaignContext({ getById, updateStatus }),
				{
					id: 2,
					expected_updated_at: "2026-07-30T09:00:00Z",
				},
			),
		).resolves.toEqual({ id: 2, status: "cancelled" });
		expect(updateStatus).not.toHaveBeenCalled();
	});

	test("rejects cancel/pause on non-running campaigns per Listmonk 6.2.0", async () => {
		// `scheduled` cannot be cancelled or paused; the server returns 400.
		const getById = mock(async () => ({
			data: { id: 5, status: "scheduled" },
		})) as unknown as CampaignClient["campaign"]["getById"];
		const updateStatus = mock(async () => ({ data: true })) as unknown as CampaignClient["campaign"]["updateStatus"];

		await expect(
			invokeCancelCampaignOperation(
				campaignContext({ getById, updateStatus }),
				{ id: 5 },
			),
		).rejects.toThrow(/transition/i);
		await expect(
			invokePauseCampaignOperation(
				campaignContext({ getById, updateStatus }),
				{ id: 5 },
			),
		).rejects.toThrow(/transition/i);
		expect(updateStatus).not.toHaveBeenCalled();
	});

	test("subscriber bulk operations chunk IDs through the shared executor", async () => {
		// One chunk, two subscribers — exercise all four bulk operations and
		// assert that manageLists / manageBlocklist receive the expected
		// action and IDs.
		const manageLists = mock(async () => ({ data: true })) as unknown as SubscriberClient["subscriber"]["manageLists"];
		const manageBlocklist = mock(async () => ({ data: true })) as unknown as SubscriberClient["subscriber"]["manageBlocklist"];

		const added = await invokeAddSubscribersToListsOperation(
			subscriberContext({ manageLists }),
			{ subscriber_ids: [1, 2], list_ids: [10] },
		);
		expect(added).toMatchObject({ processed: 2, succeeded: 2, failed: 0 });
		expect(manageLists).toHaveBeenCalledWith({
			body: { action: "add", ids: [1, 2], target_list_ids: [10] },
		});

		const removed = await invokeRemoveSubscribersFromListsOperation(
			subscriberContext({ manageLists }),
			{ subscriber_ids: [1, 2], list_ids: [10] },
		);
		expect(removed).toMatchObject({ processed: 2, succeeded: 2 });
		expect(manageLists).toHaveBeenCalledWith({
			body: { action: "remove", ids: [1, 2], target_list_ids: [10] },
		});

		const blocklisted = await invokeBlocklistSubscribersOperation(
			subscriberContext({ manageBlocklist }),
			{ subscriber_ids: [1, 2] },
		);
		expect(blocklisted).toMatchObject({ processed: 2, succeeded: 2 });
		expect(manageBlocklist).toHaveBeenCalledWith({
			body: { action: "add", ids: [1, 2] },
		});

		const unblocklisted = await invokeUnblocklistSubscribersOperation(
			subscriberContext({ manageBlocklist }),
			{ subscriber_ids: [1, 2] },
		);
		expect(unblocklisted).toMatchObject({ processed: 2, succeeded: 2 });
		// unblocklist always sends action: "remove".
		expect(manageBlocklist).toHaveBeenLastCalledWith({
			body: { action: "remove", ids: [1, 2] },
		});
	});

	test("subscriber bulk respects dry_run and max_items", async () => {
		const manageLists = mock(async () => ({ data: true })) as unknown as SubscriberClient["subscriber"]["manageLists"];

		const dryRun = await invokeAddSubscribersToListsOperation(
			subscriberContext({ manageLists }),
			{ subscriber_ids: [1, 2, 3], list_ids: [10], dry_run: true },
		);
		expect(dryRun).toMatchObject({ processed: 3, succeeded: 0 });
		expect(manageLists).not.toHaveBeenCalled();

		const capped = await invokeAddSubscribersToListsOperation(
			subscriberContext({ manageLists }),
			{ subscriber_ids: [1, 2, 3, 4, 5], list_ids: [10], max_items: 2 },
		);
		expect(capped).toMatchObject({ processed: 2, succeeded: 2 });
		expect(manageLists).toHaveBeenCalledTimes(1);
	});

	test("subscriber bulk aborts on first chunk failure when continue_on_error is false", async () => {
		// Default chunk size is 500, so two IDs fit in a single chunk. We
		// make that chunk reject and verify the failure surfaces as an
		// OperationExecutionError wrapping the bulk executor's error.
		const manageLists = mock(async () => {
			throw new Error("server rejected");
		}) as unknown as SubscriberClient["subscriber"]["manageLists"];

		await expect(
			invokeAddSubscribersToListsOperation(
				subscriberContext({ manageLists }),
				{ subscriber_ids: [1, 2], list_ids: [10] },
			),
		).rejects.toThrow(/bulk operation failed/i);
		expect(manageLists).toHaveBeenCalledTimes(1);
	});

	test("subscriber bulk records chunk failures when continue_on_error is true", async () => {
		// Default chunk size is 500, so all IDs fit in one chunk that fails.
		// With continue_on_error the failure is recorded in `errors` instead
		// of being thrown.
		const manageLists = mock(async () => {
			throw new Error("server rejected");
		}) as unknown as SubscriberClient["subscriber"]["manageLists"];

		const result = await invokeAddSubscribersToListsOperation(
			subscriberContext({ manageLists }),
			{
				subscriber_ids: [1, 2],
				list_ids: [10],
				continue_on_error: true,
			},
		);
		expect(result.processed).toBe(2);
		expect(result.succeeded).toBe(0);
		expect(result.failed).toBe(2);
		expect(result.errors).toEqual([
			"Chunk at offset 0 (2 subscribers) failed",
		]);
		expect(JSON.stringify(result)).not.toContain("server rejected");
	});

	test("uploads media files through the shared operation", async () => {
		// 1x1 transparent PNG — small enough to stay well under the cap.
		const pngBase64 =
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
		const upload = mock(async (options: { body: Blob }) => ({
			data: {
				id: 42,
				filename: "pixel.png",
				content_type: options.body.type || "image/png",
				uuid: "media-uuid",
			},
		})) as unknown as MediaClient["media"]["upload"];

		const uploaded = await invokeUploadMediaOperation(
			mediaContext({ upload }),
			{
				base64: pngBase64,
				filename: "pixel.png",
				content_type: "image/png",
			},
		);
		expect(uploaded).toMatchObject({
			id: 42,
			filename: "pixel.png",
			content_type: "image/png",
		});
		expect(upload).toHaveBeenCalledTimes(1);
	});

	test("accepts URL-safe base64 payloads and normalizes them before decoding", async () => {
		// Same 1x1 PNG as above but encoded with the URL-safe alphabet
		// (`-`/`_` instead of `+`/`/`). The decoder must normalize before
		// calling atob, which does not recognize the URL-safe alphabet in
		// browsers.
		const urlSafeBase64 =
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk-M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
		const upload = mock(async () => ({
			data: {
				id: 43,
				filename: "pixel.png",
				content_type: "image/png",
			},
		})) as unknown as MediaClient["media"]["upload"];

		const uploaded = await invokeUploadMediaOperation(
			mediaContext({ upload }),
			{
				base64: urlSafeBase64,
				filename: "pixel.png",
				content_type: "image/png",
			},
		);
		expect(uploaded).toMatchObject({ id: 43, filename: "pixel.png" });
		expect(upload).toHaveBeenCalledTimes(1);
	});

	test("rejects media uploads that exceed the size cap or MIME allowlist", async () => {
		const upload = mock(async () => ({ data: {} })) as unknown as MediaClient["media"]["upload"];

		// 11 MiB of zero bytes base64-encoded — over the 10 MiB cap.
		const oversized = "A".repeat(Math.ceil((11 * 1024 * 1024 * 4) / 3));
		await expect(
			invokeUploadMediaOperation(
				mediaContext({ upload }),
				{ base64: oversized, filename: "huge.bin" },
			),
		).rejects.toEqual(
			expect.objectContaining<Partial<OperationInputError>>({
				name: "OperationInputError",
			}),
		);

		// Disallowed MIME type.
		const pngBase64 =
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
		await expect(
			invokeUploadMediaOperation(
				mediaContext({ upload }),
				{
					base64: pngBase64,
					filename: "evil.exe",
					content_type: "application/x-msdownload",
				},
			),
		).rejects.toEqual(
			expect.objectContaining<Partial<OperationInputError>>({
				name: "OperationInputError",
			}),
		);

		expect(upload).not.toHaveBeenCalled();
	});
});
