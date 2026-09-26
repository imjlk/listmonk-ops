import type { ListmonkClient, Template } from "@listmonk-ops/openapi";

type TemplateClient = Pick<ListmonkClient, "template">["template"];

interface StoredTemplate {
	id: number;
	name: string;
	type: string;
	subject: string;
	body: string;
	body_source: string | null;
	is_default: boolean;
}

interface TemplateRequestBody {
	name?: string;
	type?: string;
	subject?: string;
	body?: string;
	body_source?: string | null;
}

// cmd/templates.go regexpTplTag: campaign bodies must embed the content slot.
const CAMPAIGN_CONTENT_PLACEHOLDER =
	/{{(\s+)?template\s+?"content"(\s+)?\.(\s+)?}}/;

function isCampaignType(type: string | undefined): boolean {
	return type === "campaign" || type === "campaign_visual";
}

function badRequest(message: string) {
	return { error: { message }, response: { status: 400 } };
}

// cmd/handlers.go stdInputMaxLen.
const STD_INPUT_MAX_LEN = 2000;

/** cmd/templates.go validateTemplate. */
function validationError(body: TemplateRequestBody): string | undefined {
	if (!body.name || body.name.length > STD_INPUT_MAX_LEN) {
		return "Invalid name";
	}
	if (
		body.type === "campaign" &&
		!CAMPAIGN_CONTENT_PLACEHOLDER.test(body.body ?? "")
	) {
		return 'The placeholder {{ template "content" . }} should appear in the template';
	}
	if (body.type === "tx" && (body.subject ?? "").trim() === "") {
		return "Missing fields: subject";
	}
	return undefined;
}

/**
 * In-memory mirror of how Listmonk 6.2 persists templates, so reconcile tests
 * observe the server's rewrites rather than an echo of the request:
 *
 * - CreateTemplate/UpdateTemplate blank the subject of campaign and
 *   campaign_visual requests (cmd/templates.go);
 * - update-template keeps the previous name, body, and body_source for empty
 *   values, stores `subject = CASE WHEN $3 != '' THEN $3 ELSE name END` with
 *   the row's previous name, and never writes `type` (queries/templates.sql);
 * - get-templates blanks body and body_source when `no_body` is set.
 */
export function createListmonk62TemplateStore(
	seed: readonly Omit<StoredTemplate, "id" | "is_default">[] = [],
) {
	const rows = new Map<number, StoredTemplate>();
	let nextId = 1;
	const mutations = { create: 0, update: 0 };

	function insert(row: Omit<StoredTemplate, "id" | "is_default">): StoredTemplate {
		const stored = { ...row, id: nextId, is_default: false };
		nextId += 1;
		rows.set(stored.id, stored);
		return stored;
	}

	function project(row: StoredTemplate, noBody: boolean): Template {
		return {
			id: row.id,
			name: row.name,
			type: row.type,
			subject: row.subject,
			body: noBody ? "" : row.body,
			body_source: (noBody ? null : row.body_source) as string | undefined,
			is_default: row.is_default,
		};
	}

	for (const row of seed) insert(row);

	const template = {
		list: async (options?: { query?: { no_body?: boolean } }) => {
			const noBody = options?.query?.no_body === true;
			const results = [...rows.values()].map((row) => project(row, noBody));
			return {
				data: {
					results,
					total: results.length,
					per_page: results.length,
					page: 1,
				},
			};
		},
		getById: async ({ path }: { path: { id: number } }) => {
			const row = rows.get(path.id);
			return row === undefined
				? badRequest("Template not found")
				: { data: project(row, false) };
		},
		create: async ({ body }: { body: TemplateRequestBody }) => {
			const invalid = validationError(body);
			if (invalid !== undefined) return badRequest(invalid);
			mutations.create += 1;
			const stored = insert({
				name: body.name ?? "",
				type: body.type ?? "campaign",
				subject: isCampaignType(body.type) ? "" : (body.subject ?? ""),
				body: body.body ?? "",
				body_source: body.body_source ?? null,
			});
			return { data: project(stored, false) };
		},
		update: async ({
			path,
			body,
		}: {
			path: { id: number };
			body: TemplateRequestBody;
		}) => {
			const invalid = validationError(body);
			if (invalid !== undefined) return badRequest(invalid);
			const row = rows.get(path.id);
			if (row === undefined) return badRequest("Template not found");
			mutations.update += 1;
			const subject = isCampaignType(body.type) ? "" : (body.subject ?? "");
			const previousName = row.name;
			row.name = body.name ? body.name : row.name;
			row.subject = subject !== "" ? subject : previousName;
			row.body = body.body ? body.body : row.body;
			row.body_source = body.body_source ? body.body_source : row.body_source;
			return { data: project(row, false) };
		},
	};

	return {
		template: template as unknown as TemplateClient,
		mutations,
		stored(name: string): StoredTemplate | undefined {
			return [...rows.values()].find((row) => row.name === name);
		},
	};
}
