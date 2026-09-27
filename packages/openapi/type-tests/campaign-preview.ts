import type { ListmonkClient } from "../index";

/**
 * Compile-time contract for the campaign preview wrappers: they accept every
 * form field the Listmonk 6.2 handler reads and resolve to the rendered body.
 */
export async function campaignPreviewContract(client: ListmonkClient) {
	const preview = await client.campaign.updatePreview({
		path: { id: 1 },
		body: { body: "# Hi", content_type: "markdown", template_id: 2 },
	});
	const text = await client.campaign.previewText({
		path: { id: 1 },
		body: { body: "Hi", content_type: "plain" },
	});
	const rendered: string[] = [preview.data, text.data];

	const unknownFormat = {
		path: { id: 1 },
		body: { body: "Hi", content_type: "docx" },
	} as const;
	// @ts-expect-error Listmonk 6.2 has no "docx" campaign content type.
	await client.campaign.updatePreview(unknownFormat);

	return rendered;
}
