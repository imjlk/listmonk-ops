import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import {
	renderCampaigns,
	type CampaignsCliContext,
} from "../src/commands/campaigns";
import {
	renderCreateSubscriber,
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
	type MediaCliContext,
} from "../src/commands/media";

function output() {
	return {
		info: mock(() => undefined),
		json: mock(() => undefined),
		success: mock(() => undefined),
		table: mock(() => undefined),
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
});
