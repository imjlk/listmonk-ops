import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import {
	renderCancelCampaign,
	renderCloneCampaign,
	renderGetCampaignStats,
	renderPauseCampaign,
	renderScheduleCampaign,
	renderStartCampaign,
	renderCampaigns,
	type CampaignsCliContext,
} from "../src/commands/campaigns";
import {
	renderAddSubscribersToLists,
	renderBlocklistSubscribers,
	renderCreateSubscriber,
	renderRemoveSubscribersFromLists,
	renderUnblocklistSubscribers,
	type SubscribersCliContext,
} from "../src/commands/subscribers";
import {
	renderSetDefaultTemplate,
	renderUpdateTemplate,
	type TemplatesCliContext,
} from "../src/commands/templates";
import {
	renderDeleteMedia,
	renderMedia,
	renderUploadMedia,
	type MediaCliContext,
} from "../src/commands/media";

function output() {
	return {
		info: mock(() => undefined),
		json: mock(() => undefined),
		success: mock(() => undefined),
		table: mock(() => undefined),
		warning: mock(() => undefined),
	};
}

describe("campaign, subscriber, template, and media CLI actions", () => {
	test("renders campaigns through the shared operation", async () => {
		const list = mock(async () => ({
			data: { results: [{ id: 3, name: "Newsletter" }], total: 1 },
		}));
		const cliContext = {
			client: { campaign: { list } } as unknown as Pick<
				ListmonkClient,
				"campaign"
			>,
			output: output(),
		} satisfies CampaignsCliContext;

		await renderCampaigns(cliContext, { page: 2, per_page: 5 });

		expect(list).toHaveBeenCalledWith({
			query: { page: 2, per_page: 5 },
		});
		expect(cliContext.output.table).toHaveBeenCalledWith([
			{ id: 3, name: "Newsletter" },
		]);
	});

	test("creates subscribers through the shared operation", async () => {
		const create = mock(async () => ({
			data: { id: 8, email: "user@example.com", name: "User" },
		}));
		const cliContext = {
			client: { subscriber: { create } } as unknown as Pick<
				ListmonkClient,
				"subscriber"
			>,
			output: output(),
		} satisfies SubscribersCliContext;

		await renderCreateSubscriber(cliContext, {
			email: "user@example.com",
			name: "User",
		});

		expect(create).toHaveBeenCalledWith({
			body: {
				email: "user@example.com",
				name: "User",
				status: "enabled",
				lists: [],
				attribs: {},
			},
		});
		expect(cliContext.output.success).toHaveBeenCalledWith("Subscriber created: 8");
	});

	test("updates templates through the shared merge operation", async () => {
		const getById = mock(async () => ({
			data: {
				id: 5,
				name: "Existing",
				type: "campaign",
				body: "<p>Old</p>",
				subject: "Subject",
			},
		}));
		const update = mock(async () => ({
			data: { id: 5, name: "Existing", type: "campaign", body: "<p>New</p>" },
		}));
		const cliContext = {
			client: { template: { getById, update } } as unknown as Pick<
				ListmonkClient,
				"template"
			>,
			output: output(),
		} satisfies TemplatesCliContext;

		await renderUpdateTemplate(cliContext, { id: 5, body: "<p>New</p>" });

		expect(update).toHaveBeenCalledWith({
			path: { id: 5 },
			body: {
				name: "Existing",
				type: "campaign",
				subject: "Subject",
				body: "<p>New</p>",
				body_source: undefined,
			},
		});
	});

	test("sets a default template through the shared operation", async () => {
		const setAsDefault = mock(async () => ({
			data: [],
		}));
		const cliContext = {
			client: { template: { setAsDefault } } as unknown as Pick<
				ListmonkClient,
				"template"
			>,
			output: output(),
		} satisfies TemplatesCliContext;

		await renderSetDefaultTemplate(cliContext, { id: 5 });

		expect(setAsDefault).toHaveBeenCalledWith({ path: { id: 5 } });
		expect(cliContext.output.success).toHaveBeenCalledWith(
			"Default template set: 5",
		);
		expect(cliContext.output.json).toHaveBeenCalledWith(
			{ id: 5, set_default: true },
		);
	});

	test("lists and deletes media through shared operations", async () => {
		const list = mock(async () => ({
			data: {
				results: [{ id: 14, filename: "newsletter.png" }],
				total: 1,
				per_page: 1,
				page: 1,
			},
		}));
		const deleteById = mock(async () => ({ data: true }));
		const cliContext = {
			client: { media: { list, deleteById } } as unknown as Pick<
				ListmonkClient,
				"media"
			>,
			output: output(),
		} satisfies MediaCliContext;

		await renderMedia(cliContext, { page: 1, per_page: 20 });
		await renderDeleteMedia(cliContext, { id: 14 });

		expect(list).toHaveBeenCalledTimes(1);
		expect(cliContext.output.table).toHaveBeenCalledWith([
			{ id: 14, filename: "newsletter.png" },
		]);
		expect(deleteById).toHaveBeenCalledWith({ path: { id: 14 } });
		expect(cliContext.output.success).toHaveBeenCalledWith(
			"Media file deleted: 14",
		);
		expect(cliContext.output.json).toHaveBeenCalledWith({
			id: 14,
			deleted: true,
		});
	});

	test("renders campaign lifecycle transitions through the shared renderers", async () => {
		// The renderers delegate to the named shared invokers; the operations
		// package owns the validation logic. We only assert the call edges
		// that anchor the CLI handler → renderer → invoker chain in the graph.
		// State machine is exercised end-to-end: the mock tracks the current
		// status so each transition sees the previous one's effect.
		let currentStatus = "draft";
		const campaign = {
			getById: mock(async () => ({
				data: {
					id: 10,
					status: currentStatus,
					// Required create fields so clone's input validation passes.
					subject: "Subject",
					from_email: "sender@example.com",
					body: "<p>Hi</p>",
					type: "regular",
					content_type: "html",
					messenger: "email",
					template_id: 3,
					lists: [{ id: 1 }],
				},
			})),
			update: mock(async () => ({ data: {} })),
			updateStatus: mock(async ({ body }: { body: { status: string } }) => {
				currentStatus = body.status;
				return { data: true };
			}),
			create: mock(async () => ({
				data: { id: 11, name: "Cloned", status: "draft" },
			})),
			// clone snapshots existing same-name campaigns via list before create.
			list: mock(async () => ({
				data: { results: [], total: 0, per_page: 100, page: 1 },
			})),
		};
		const cliContext = {
			client: { campaign } as unknown as Pick<
				ListmonkClient,
				"campaign"
			>,
			output: output(),
		} satisfies CampaignsCliContext;

		await renderScheduleCampaign(cliContext, {
			id: 10,
			send_at: "2026-08-01T09:00:00Z",
		});
		expect(cliContext.output.success).toHaveBeenCalledWith(
			"Campaign 10 scheduled for 2026-08-01T09:00:00Z",
		);

		await renderStartCampaign(cliContext, { id: 10 });
		expect(cliContext.output.success).toHaveBeenCalledWith(
			"Campaign 10 started",
		);

		// Listmonk 6.2.0 only accepts cancel from `running`, so cancel must
		// run while the campaign is still running (before any pause).
		await renderCancelCampaign(cliContext, { id: 10 });
		expect(cliContext.output.success).toHaveBeenCalledWith(
			"Campaign 10 cancelled",
		);

		// Pause is exercised separately: reset to running, then pause.
		currentStatus = "running";
		await renderPauseCampaign(cliContext, { id: 10 });
		expect(cliContext.output.success).toHaveBeenCalledWith(
			"Campaign 10 paused",
		);

		await renderCloneCampaign(cliContext, { id: 10, name: "Clone" });
		expect(cliContext.output.success).toHaveBeenCalledWith(
			"Campaign 10 cloned as 'Clone'",
		);

		await renderGetCampaignStats(cliContext, { id: 10 });
		expect(cliContext.output.success).toHaveBeenCalledWith(
			"Campaign 10 stats",
		);
	});

	test("renders subscriber bulk operations through the shared renderers", async () => {
		// The renderers delegate to the named shared invokers; the operations
		// package owns the chunking and dry-run logic. We assert the call
		// edges that anchor the CLI handler → renderer → invoker chain.
		const subscriber = {
			manageLists: mock(async () => ({ data: true })),
			manageBlocklist: mock(async () => ({ data: true })),
		};
		const cliContext = {
			client: { subscriber } as unknown as Pick<
				ListmonkClient,
				"subscriber"
			>,
			output: output(),
		} satisfies SubscribersCliContext;

		await renderAddSubscribersToLists(cliContext, {
			subscriber_ids: [1, 2],
			list_ids: [10],
		});
		expect(cliContext.output.success).toHaveBeenCalledWith(
			"Added 2 of 2 subscribers to lists",
		);

		await renderRemoveSubscribersFromLists(cliContext, {
			subscriber_ids: [1, 2],
			list_ids: [10],
		});
		expect(cliContext.output.success).toHaveBeenCalledWith(
			"Removed 2 of 2 subscribers from lists",
		);

		await renderBlocklistSubscribers(cliContext, {
			subscriber_ids: [1, 2],
		});
		expect(cliContext.output.success).toHaveBeenCalledWith(
			"Blocklisted 2 of 2 subscribers",
		);

		await renderUnblocklistSubscribers(cliContext, {
			subscriber_ids: [1, 2],
		});
		expect(cliContext.output.success).toHaveBeenCalledWith(
			"Unblocklisted 2 of 2 subscribers",
		);
	});

	test("renders media uploads through the shared renderer", async () => {
		// 1x1 transparent PNG, base64-encoded.
		const pngBase64 =
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
		const upload = mock(async () => ({
			data: {
				id: 42,
				filename: "pixel.png",
				content_type: "image/png",
			},
		}));
		const cliContext = {
			client: { media: { upload } } as unknown as Pick<
				ListmonkClient,
				"media"
			>,
			output: output(),
		} satisfies MediaCliContext;

		await renderUploadMedia(cliContext, {
			base64: pngBase64,
			filename: "pixel.png",
			content_type: "image/png",
		});
		expect(cliContext.output.success).toHaveBeenCalledWith(
			"Media file uploaded: pixel.png",
		);
		expect(upload).toHaveBeenCalledTimes(1);
	});
});
