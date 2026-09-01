import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import {
	invokePreviewCampaignOperation,
	invokeTestCampaignOperation,
} from "../src/campaigns";
import { OperationExecutionError } from "../src/operation";

type CampaignClient = Pick<ListmonkClient, "campaign">;

function campaignContext(
	methods: Partial<CampaignClient["campaign"]>,
): { client: CampaignClient } {
	return { client: { campaign: methods } as CampaignClient };
}

describe("campaign preview and test operations", () => {
	test("renders the stored campaign body through the preview operation", async () => {
		const preview = mock(async () => ({
			data: "<p>Hello {{ .Subscriber.Name }}</p>",
		}));

		await expect(
			invokePreviewCampaignOperation(
				campaignContext({
					preview: preview as CampaignClient["campaign"]["preview"],
				}),
				{ id: "1" },
			),
		).resolves.toEqual({ html: "<p>Hello {{ .Subscriber.Name }}</p>" });
		expect(preview).toHaveBeenCalledWith({ path: { id: 1 } });
	});

	test("rejects a preview response that is not rendered HTML", async () => {
		const preview = mock(async () => ({ data: "" }));
		await expect(
			invokePreviewCampaignOperation(
				campaignContext({
					preview: preview as unknown as CampaignClient["campaign"]["preview"],
				}),
				{ id: 1 },
			),
		).rejects.toThrow("did not return rendered HTML");
	});

	test("derives the campaign form and sends the test message", async () => {
		const getById = mock(async () => ({
			data: {
				id: 1,
				name: "Test campaign",
				subject: "Welcome",
				lists: [{ id: 1 }, { id: 2 }],
				content_type: "richtext",
				template_id: 1,
				messenger: "email",
				from_email: "No Reply <noreply@yoursite.com>",
				body: "<p>Stored body</p>",
			},
		}));
		const test = mock(async () => ({ data: true }));

		await expect(
			invokeTestCampaignOperation(
				campaignContext({
					getById: getById as CampaignClient["campaign"]["getById"],
					test: test as unknown as CampaignClient["campaign"]["test"],
				}),
				{
					id: 1,
					subscribers: ["Reader@Example.com"],
					subject: "Override",
				},
			),
		).resolves.toEqual({
			id: 1,
			subscribers: ["reader@example.com"],
			sent: true,
		});

		expect(test).toHaveBeenCalledTimes(1);
		const form = (test.mock.calls[0]?.[0] as { body: Record<string, unknown> })
			.body;
		// The stored campaign supplies the required form fields; the caller
		// only overrides the subject, and the recipients ride the observed
		// `subscribers` key the upstream schema does not model.
		expect(form).toMatchObject({
			name: "Test campaign",
			subject: "Override",
			lists: [1, 2],
			content_type: "richtext",
			messenger: "email",
			from_email: "No Reply <noreply@yoursite.com>",
			body: "<p>Stored body</p>",
			subscribers: ["reader@example.com"],
		});
	});

	test("rejects invalid recipients before any request is issued", async () => {
		const getById = mock(async () => ({ data: {} }));
		const test = mock(async () => ({ data: true }));
		await expect(
			invokeTestCampaignOperation(
				campaignContext({
					getById: getById as CampaignClient["campaign"]["getById"],
					test: test as unknown as CampaignClient["campaign"]["test"],
				}),
				{ id: 1, subscribers: ["not-an-email"] },
			),
		).rejects.toThrow();
		expect(test).not.toHaveBeenCalled();

		const tooMany = Array.from({ length: 11 }, (_, i) => `r${i}@example.com`);
		await expect(
			invokeTestCampaignOperation(
				campaignContext({
					getById: getById as CampaignClient["campaign"]["getById"],
					test: test as unknown as CampaignClient["campaign"]["test"],
				}),
				{ id: 1, subscribers: tooMany },
			),
		).rejects.toThrow();
		expect(test).not.toHaveBeenCalled();
	});

	test("surfaces a negative test-send acknowledgement", async () => {
		const getById = mock(async () => ({
			data: {
				id: 1,
				name: "N",
				subject: "S",
				lists: [{ id: 1 }],
				body: "b",
			},
		}));
		const test = mock(async () => ({ data: false }));
		const error = await invokeTestCampaignOperation(
			campaignContext({
				getById: getById as CampaignClient["campaign"]["getById"],
				test: test as unknown as CampaignClient["campaign"]["test"],
			}),
			{ id: 1, subscribers: ["reader@example.com"] },
		).catch((failure: unknown) => failure);
		expect(error).toBeInstanceOf(OperationExecutionError);
		expect((error as Error).message).toContain("negative acknowledgement");
	});
});
