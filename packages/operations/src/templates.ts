import type { ResourceCreateIdempotencyStore } from "@listmonk-ops/common";
import type { ListmonkClient, Template } from "@listmonk-ops/openapi";
import {
	bindTemplatesCreateOperationSpec,
	bindTemplatesDeleteOperationSpec,
	bindTemplatesGetOperationSpec,
	bindTemplatesListOperationSpec,
	bindTemplatesReconcileOperationSpec,
	bindTemplatesSetDefaultOperationSpec,
	bindTemplatesUpdateOperationSpec,
} from "./specs";
import { z } from "zod";
import {
	createResourceSafety,
	deleteResourceSafety,
	jsonResourceValue,
	normalizeResourceList,
	optionalBooleanSchema,
	readResourceSafety,
	resourceIdSchema,
	isResourceMissingError,
	ResourceResponseError,
	toResourceErrorMessage,
	unwrapResourceResponse,
	updateResourceSafety,
} from "./resource-helpers";
import { defineOperationCatalog } from "./catalog";
import { executeKeyedCreate } from "./keyed-create";
import { isDefinitivePreDispatchError } from "./transactional-idempotency";
import {
	defineOperation,
	normalizeOperationExecutionError,
	OperationExecutionError,
	OperationInputError,
	parseOperationInput,
	parseOperationOutput,
} from "./operation";

export interface TemplateOperationContext {
	client: Pick<ListmonkClient, "template">;
	/**
	 * Adapter-supplied resource-create idempotency store. When absent, an
	 * `idempotency_key` is rejected as unsupported on this surface; CLI and
	 * MCP inject a file-backed implementation.
	 */
	createIdempotencyStore?: ResourceCreateIdempotencyStore;
	/** SHA-256 digest helper paired with the store (runtime-neutral). */
	hashCreatePayload?: (serialized: string) => string;
	/**
	 * Resolved Listmonk identity namespacing idempotency records. Required
	 * when `idempotency_key` is used so a key can never replay across
	 * instances.
	 */
	target?: {
		baseUrl?: string;
		username?: string;
	};
}

const templateTypeSchema = z.enum(["campaign", "campaign_visual", "tx"]);

const templateSchema = z.looseObject({
	id: z.number().int().positive().optional(),
	created_at: z.string().optional(),
	updated_at: z.string().optional(),
	name: z.string().optional(),
	body: z.string().optional(),
	body_source: z.string().nullable().optional(),
	subject: z.string().optional(),
	type: z.string().optional(),
	is_default: z.boolean().optional(),
});

const templateListOutputSchema = z.object({
	results: z.array(templateSchema),
	total: z.number(),
	per_page: z.number(),
	page: z.number(),
});

const templateIdInputSchema = z.object({
	id: resourceIdSchema,
});

const templateListInputSchema = z.object({
	page: z.coerce.number().int().positive().default(1),
	per_page: z.coerce.number().int().positive().default(20),
	no_body: optionalBooleanSchema.optional(),
});

const createTemplateInputSchema = z.object({
	name: z.string().trim().min(1),
	idempotency_key: z
		.string()
		.trim()
		.min(1)
		.max(200)
		.optional()
		.describe(
			"Caller-scoped create key; an identical retry with the same key replays the originally created template instead of creating a duplicate",
		),
	type: templateTypeSchema.default("campaign"),
	subject: z.string().optional().default(""),
	body_source: z.string().optional(),
	body: z.string().min(1),
});

const templateCreateOutputSchema = z.object({
	template: templateSchema,
	created: z.boolean(),
});

export const MAX_TEMPLATE_MANIFEST_BYTES = 1024 * 1024;
const TEMPLATE_MANIFEST_OPERATION_ID = "templates.reconcile";

function templateManifestByteLength(manifest: {
	schema_version: 1;
	templates: readonly z.output<typeof createTemplateInputSchema>[];
}): number {
	return new TextEncoder().encode(
		JSON.stringify({
			schema_version: manifest.schema_version,
			templates: manifest.templates,
		}),
	).byteLength;
}

const templateManifestSchema = z
	.object({
		schema_version: z.literal(1),
		templates: z.array(createTemplateInputSchema).min(1),
	})
	.superRefine((manifest, context) => {
		if (templateManifestByteLength(manifest) > MAX_TEMPLATE_MANIFEST_BYTES) {
			context.addIssue({
				code: "custom",
				message:
					`Template manifest exceeds the ${MAX_TEMPLATE_MANIFEST_BYTES}-byte limit`,
			});
		}
		const names = new Set<string>();
		for (const [index, template] of manifest.templates.entries()) {
			if (names.has(template.name)) {
				context.addIssue({
					code: "custom",
					message: `Template manifest contains duplicate name ${JSON.stringify(template.name)}`,
					path: ["templates", index, "name"],
				});
			}
			names.add(template.name);
		}
	});

// Manifest entries are constrained to the 120-character name bound declared
// by the standalone contract. The shared createTemplateInputSchema stays
// unbounded so templates.create/update keep accepting longer Listmonk names.
const templateManifestEntrySchema = createTemplateInputSchema.extend({
	name: z.string().trim().min(1).max(120),
});

const templateManifestOperationInputSchema = templateManifestSchema.safeExtend({
	templates: z.array(templateManifestEntrySchema).min(1).max(500),
	dry_run: z.boolean().default(true),
});

const templateReconcileSummarySchema = z.object({
	name: z.string().min(1).max(120),
	action: z.enum(["create", "update", "unchanged"]),
	applied: z.boolean(),
});

const templateManifestOperationOutputSchema = z.object({
	schema_version: z.literal(1),
	dry_run: z.boolean(),
	results: z.array(templateReconcileSummarySchema),
});

export type TemplateDesiredState = z.input<typeof createTemplateInputSchema>;
export type TemplateManifest = z.input<typeof templateManifestSchema>;

export interface TemplateReconcileOptions {
	/** Apply the planned mutation. Omit or set false for a read-only plan. */
	apply?: boolean;
}

export interface TemplateReconcileResult {
	name: string;
	action: "create" | "update" | "unchanged";
	applied: boolean;
	template?: z.output<typeof templateSchema>;
}

export interface TemplateManifestReconcileResult {
	schema_version: 1;
	apply: boolean;
	results: TemplateReconcileResult[];
}

export type TemplateManifestOperationInput = z.input<
	typeof templateManifestOperationInputSchema
>;

export type TemplateManifestOperationResult = z.output<
	typeof templateManifestOperationOutputSchema
>;

export class TemplateManifestApplyError extends Error {
	public readonly failedTemplate: string;
	public readonly appliedResults: readonly TemplateReconcileResult[];

	public constructor(
		failedTemplate: string,
		appliedResults: readonly TemplateReconcileResult[],
		cause: unknown,
	) {
		super(
			`Template manifest apply failed at ${JSON.stringify(failedTemplate)} after ${appliedResults.length} completed entries`,
			{ cause },
		);
		this.name = "TemplateManifestApplyError";
		this.failedTemplate = failedTemplate;
		this.appliedResults = [...appliedResults];
	}
}

/**
 * Project a reconcile result into the body-free summary shape exposed through
 * the shared surface. Template bodies, IDs, and any remote error body are
 * intentionally dropped so a manifest apply cannot leak credential-adjacent
 * metadata through either success or partial-failure paths.
 */
function toTemplateReconcileSummary(result: {
	name: string;
	action: "create" | "update" | "unchanged";
	applied: boolean;
}): z.output<typeof templateReconcileSummarySchema> {
	const { name, action, applied } = result;
	return { name, action, applied };
}

/** Body-free partial apply details projected through shared surface errors. */
export class TemplateManifestOperationApplyError extends OperationExecutionError {
	public readonly failedTemplate: string;
	public readonly appliedResults: readonly z.output<
		typeof templateReconcileSummarySchema
	>[];

	public constructor(error: TemplateManifestApplyError) {
		const appliedResults = error.appliedResults.map(toTemplateReconcileSummary);
		// Drop the raw remote cause so the projected error cannot leak the
		// Listmonk error body or other credential-adjacent metadata through a
		// nested cause chain; only the bounded apply message is preserved.
		super(
			TEMPLATE_MANIFEST_OPERATION_ID,
			new Error(
				`${error.message}; completed entries: ${JSON.stringify(appliedResults)}`,
			),
		);
		this.name = "TemplateManifestOperationApplyError";
		this.failedTemplate = error.failedTemplate;
		this.appliedResults = appliedResults;
	}
}

function parseTemplateManifestOperationInput(
	input: unknown,
): z.output<typeof templateManifestOperationInputSchema> {
	// Enforce the serialized-payload cap on the untransformed input before Zod
	// normalizes it. Only the transport-only dry_run control is excluded so the
	// documented 1 MiB limit still rejects unknown oversized fields that Zod
	// would otherwise strip.
	const { dry_run: _excludedDryRun, ...measuredInput } =
		typeof input === "object" && input !== null && !Array.isArray(input)
			? (input as Record<string, unknown>)
			: {};
	const rawByteLength = new TextEncoder().encode(
		JSON.stringify(measuredInput),
	).byteLength;
	if (rawByteLength > MAX_TEMPLATE_MANIFEST_BYTES) {
		throw new OperationInputError(
			`Template manifest exceeds the ${MAX_TEMPLATE_MANIFEST_BYTES}-byte limit`,
		);
	}
	return parseOperationInput(templateManifestOperationInputSchema, input);
}

function normalizeTemplateManifestOperationError(error: unknown) {
	if (error instanceof TemplateManifestApplyError) {
		return new TemplateManifestOperationApplyError(error);
	}
	return normalizeOperationExecutionError(
		TEMPLATE_MANIFEST_OPERATION_ID,
		error,
	);
}

const updateTemplateInputSchema = z
	.object({
		id: resourceIdSchema,
		name: z.string().trim().min(1).optional(),
		type: templateTypeSchema.optional(),
		subject: z.string().optional(),
		body_source: z.string().optional(),
		body: z.string().min(1).optional(),
	})
	.refine(
		({ id: _id, ...changes }) =>
			Object.values(changes).some((value) => value !== undefined),
		{
			message: "At least one template field must be provided for update",
			path: ["id"],
		},
	);

const deleteTemplateOutputSchema = z.object({
	id: z.number().int().positive(),
	deleted: z.boolean(),
});

const setDefaultTemplateOutputSchema = z.object({
	id: z.number().int().positive(),
	set_default: z.literal(true),
});

export type TemplateListPage = z.output<typeof templateListOutputSchema>;

type TemplateCreateBody = NonNullable<
	Parameters<ListmonkClient["template"]["create"]>[0]["body"]
>;
type TemplateUpdateBody = NonNullable<
	Parameters<ListmonkClient["template"]["update"]>[0]["body"]
>;
type TemplateListOptions = Parameters<
	ListmonkClient["template"]["list"]
>[0];

function asTemplate(value: Template): z.output<typeof templateSchema> {
	return value as z.output<typeof templateSchema>;
}

function isPositiveSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export async function listTemplates(
	{ client }: TemplateOperationContext,
	input: z.output<typeof templateListInputSchema>,
): Promise<TemplateListPage> {
	const response = await client.template.list(
		input.no_body === undefined
			? undefined
			: { query: { no_body: input.no_body } },
	);
	const data = unwrapResourceResponse(response, "Failed to fetch templates");
	const normalized = normalizeResourceList(data, {
		page: 1,
		per_page: data.results?.length ?? 0,
	});
	const start = (input.page - 1) * input.per_page;
	return {
		results: normalized.results.slice(start, start + input.per_page),
		total: normalized.total,
		per_page: input.per_page,
		page: input.page,
	};
}

export async function getTemplate(
	{ client }: TemplateOperationContext,
	input: z.output<typeof templateIdInputSchema>,
): Promise<z.output<typeof templateSchema>> {
	const response = await client.template.getById({ path: { id: input.id } });
	return asTemplate(
		unwrapResourceResponse(response, "Failed to fetch template"),
	);
}

async function findCreatedTemplate(
	client: Pick<ListmonkClient, "template">,
	name: string,
): Promise<Template | undefined> {
	const pageSize = 100;
	const firstResponse = await client.template.list();
	const firstPage = unwrapResourceResponse(
		firstResponse,
		"Failed to resolve created template",
	);
	const firstMatch = firstPage.results?.find(
		(template) => template.name === name,
	);
	if (firstMatch) return firstMatch;

	const pageCount = Math.max(
		1,
		Math.ceil(
			(firstPage.total ?? 0) / Math.max(firstPage.per_page ?? pageSize, 1),
		),
	);
	for (let page = 2; page <= pageCount; page += 1) {
		const response = await client.template.list({
			query: { page, per_page: pageSize },
		} as TemplateListOptions);
		const pageData = unwrapResourceResponse(
			response,
			"Failed to resolve created template",
		);
		const match = pageData.results?.find((template) => template.name === name);
		if (match) return match;
	}

	return undefined;
}

export interface TemplateCreateResult {
	template: z.output<typeof templateSchema>;
	created: boolean;
}

function canonicalTemplateCreatePayload(
	input: z.output<typeof createTemplateInputSchema>,
): Record<string, unknown> {
	return {
		name: input.name,
		type: input.type,
		subject: input.subject,
		body_source: input.body_source ?? null,
		body: input.body,
	};
}

async function createTemplateUnkeyed(
	client: Pick<ListmonkClient, "template">,
	body: TemplateCreateBody,
	name: string,
): Promise<TemplateCreateResult> {
	const response = await client.template.create({ body });
	if ("error" in response && response.error !== undefined) {
		throw new Error(
			`Failed to create template: ${toResourceErrorMessage(response.error)}`,
		);
	}
	if (response.data !== undefined) {
		return { template: asTemplate(response.data), created: true };
	}

	const created = await findCreatedTemplate(client, name);
	if (!created) {
		throw new Error(
			"Template was created but the created record could not be resolved",
		);
	}
	return { template: asTemplate(created), created: true };
}

export async function createTemplate(
	{
		client,
		createIdempotencyStore,
		hashCreatePayload,
		target,
	}: TemplateOperationContext,
	input: z.output<typeof createTemplateInputSchema>,
): Promise<TemplateCreateResult> {
	const { idempotency_key, ...bodyFields } = input;
	const body = bodyFields as TemplateCreateBody;
	if (idempotency_key === undefined) {
		return createTemplateUnkeyed(client, body, input.name);
	}
	if (createIdempotencyStore === undefined || hashCreatePayload === undefined) {
		throw new Error(
			"idempotency_key requires a resource-create idempotency store on this surface",
		);
	}
	if (!target?.baseUrl || !target?.username) {
		throw new Error(
			"idempotency_key requires a resolved Listmonk target (baseUrl and username) so the key cannot replay across instances",
		);
	}

	const result = await executeKeyedCreate<Template>({
		store: createIdempotencyStore,
		hashCreatePayload,
		target: { baseUrl: target.baseUrl, username: target.username },
		key: idempotency_key,
		resourceKind: "template",
		resourceLabel: "template",
		canonicalPayload: canonicalTemplateCreatePayload(input),
		// Template records carry no uuid: binding is authorized only by the
		// id in the create response, never by a name match.
		resourceIdOf: (template) =>
			template.id !== undefined ? String(template.id) : undefined,
		describeResource: (template) =>
			`id ${String(template.id ?? template.name ?? "?")}`,
		replay: async (resourceId) => {
			const response = await client.template.getById({
				path: { id: Number(resourceId) },
			});
			try {
				return unwrapResourceResponse(
					response,
					`Failed to replay template ${resourceId}`,
				);
			} catch (error) {
				throw new Error(
					`Idempotency replay could not load template ${resourceId}: ${toResourceErrorMessage(error)}`,
					{ cause: error },
				);
			}
		},
		issue: async () => {
			let response: Awaited<ReturnType<typeof client.template.create>>;
			try {
				response = await client.template.create({ body });
			} catch (error) {
				return {
					failure: {
						error,
						definitive: isDefinitivePreDispatchError(error),
					},
				};
			}
			if ("error" in response && response.error !== undefined) {
				const status =
					typeof response.response?.status === "number"
						? response.response.status
						: undefined;
				return {
					failure: {
						error: new Error(
							`Failed to create template: ${toResourceErrorMessage(response.error)}`,
						),
						definitive: status !== undefined && status >= 400 && status < 500,
					},
				};
			}
			if (response.data?.id !== undefined) {
				return { resource: response.data };
			}
			return {};
		},
	});
	return { template: asTemplate(result.resource), created: result.created };
}

export async function updateTemplate(
	{ client }: TemplateOperationContext,
	input: z.output<typeof updateTemplateInputSchema>,
): Promise<z.output<typeof templateSchema>> {
	const currentResponse = await client.template.getById({
		path: { id: input.id },
	});
	const current = unwrapResourceResponse(
		currentResponse,
		"Failed to load current template",
	);
	const type = input.type ??
		(current.type === "campaign_visual" || current.type === "tx"
			? current.type
			: "campaign");
	const body = {
		name: input.name ?? current.name ?? "",
		type,
		subject: input.subject ?? current.subject ?? "",
		body: input.body ?? current.body ?? "",
		body_source:
			input.body_source !== undefined ? input.body_source : current.body_source,
	};
	if (!body.name || !body.body) {
		throw new Error("Template update requires name and body after merge");
	}

	const response = await client.template.update({
		path: { id: input.id },
		body: body as TemplateUpdateBody,
	});
	return asTemplate(
		unwrapResourceResponse(response, "Failed to update template"),
	);
}

async function planTemplateFromCandidates(
	{ client }: TemplateOperationContext,
	desired: z.output<typeof createTemplateInputSchema>,
	candidates: readonly Template[],
): Promise<TemplateReconcileResult> {
	const matches = candidates.filter(
		(template) => template.name === desired.name,
	);
	if (matches.length > 1) {
		throw new Error(
			`Template reconcile is ambiguous: ${matches.length} templates are named ${JSON.stringify(desired.name)}`,
		);
	}
	const existing = matches[0];
	if (existing === undefined) {
		return {
			name: desired.name,
			action: "create",
			applied: false,
		};
	}
	const existingId = existing.id;
	if (!isPositiveSafeInteger(existingId)) {
		throw new Error(
			`Template reconcile found ${JSON.stringify(desired.name)} with invalid ID ${JSON.stringify(existingId)}`,
		);
	}
	const current = unwrapResourceResponse(
		await client.template.getById({ path: { id: existingId } }),
		"Failed to load current template for reconcile",
	);
	if (templateMatchesDesiredState(current, desired)) {
		return {
			name: desired.name,
			action: "unchanged",
			applied: false,
			template: asTemplate(current),
		};
	}
	return {
		name: desired.name,
		action: "update",
		applied: false,
		template: asTemplate(current),
	};
}

/** Plan one exact-name template reconciliation without mutating Listmonk. */
export async function planTemplateReconcile(
	context: TemplateOperationContext,
	input: TemplateDesiredState,
): Promise<TemplateReconcileResult> {
	const desired = createTemplateInputSchema.parse(input);
	const candidates = await listTemplatesForReconcile(context.client);
	return planTemplateFromCandidates(context, desired, candidates);
}

async function applyTemplateReconcilePlan(
	context: TemplateOperationContext,
	desired: z.output<typeof createTemplateInputSchema>,
	plan: TemplateReconcileResult,
): Promise<TemplateReconcileResult> {
	if (plan.action === "unchanged") return plan;

	if (plan.action === "create") {
		return {
			...plan,
			applied: true,
			template: (await createTemplate(context, desired)).template,
		};
	}

	const existingId = plan.template?.id;
	if (!isPositiveSafeInteger(existingId)) {
		throw new Error(
			`Template update plan for ${JSON.stringify(desired.name)} is missing a positive template ID`,
		);
	}
	return {
		...plan,
		applied: true,
		template: await updateTemplate(context, {
			id: existingId,
			name: desired.name,
			type: desired.type,
			subject: desired.subject,
			body_source: desired.body_source,
			body: desired.body,
		}),
	};
}

/** Reconcile one exact-name template, read-only unless `apply` is true. */
export async function reconcileTemplate(
	context: TemplateOperationContext,
	input: TemplateDesiredState,
	options: TemplateReconcileOptions = {},
): Promise<TemplateReconcileResult> {
	const desired = createTemplateInputSchema.parse(input);
	const candidates = await listTemplatesForReconcile(context.client);
	const plan = await planTemplateFromCandidates(context, desired, candidates);
	if (options.apply !== true || plan.action === "unchanged") {
		return plan;
	}
	return applyTemplateReconcilePlan(context, desired, plan);
}

/** Ensure one exact-name template exists and matches the desired state. */
export async function ensureTemplate(
	context: TemplateOperationContext,
	input: TemplateDesiredState,
): Promise<TemplateReconcileResult> {
	return reconcileTemplate(context, input, { apply: true });
}

/**
 * Reconcile a versioned template manifest. The complete manifest is planned
 * before the first remote mutation. Remote writes are not transactional; an
 * apply failure exposes completed entries through TemplateManifestApplyError
 * so callers can reconcile the partial remote state.
 */
export async function reconcileTemplateManifest(
	context: TemplateOperationContext,
	input: TemplateManifest,
	options: TemplateReconcileOptions = {},
): Promise<TemplateManifestReconcileResult> {
	const manifest = templateManifestSchema.parse(input);
	const candidates = await listTemplatesForReconcile(context.client);
	const desiredTemplates = manifest.templates;
	const plannedTemplates: Array<{
		desired: z.output<typeof createTemplateInputSchema>;
		plan: TemplateReconcileResult;
	}> = [];
	// Bound concurrent detail reads so large manifests do not serialize all
	// network latency or create an unbounded burst against Listmonk.
	const planningConcurrency = 4;
	for (let offset = 0; offset < desiredTemplates.length; offset += planningConcurrency) {
		const batch = desiredTemplates.slice(offset, offset + planningConcurrency);
		plannedTemplates.push(
			...(await Promise.all(
				batch.map(async (desired) => ({
					desired,
					plan: await planTemplateFromCandidates(context, desired, candidates),
				})),
			)),
		);
	}
	const plans = plannedTemplates.map(({ plan }) => plan);
	if (options.apply !== true) {
		return { schema_version: 1, apply: false, results: plans };
	}

	const results: TemplateReconcileResult[] = [];
	for (const { desired, plan } of plannedTemplates) {
		try {
			results.push(await applyTemplateReconcilePlan(context, desired, plan));
		} catch (cause) {
			throw new TemplateManifestApplyError(desired.name, results, cause);
		}
	}
	return { schema_version: 1, apply: true, results };
}

/** Execute manifest reconciliation through the normalized operation boundary. */
export async function executeTemplateManifestReconcile(
	context: TemplateOperationContext,
	input: z.output<typeof templateManifestOperationInputSchema>,
): Promise<TemplateManifestOperationResult> {
	const result = await reconcileTemplateManifest(
		context,
		{
			schema_version: input.schema_version,
			templates: input.templates,
		},
		{ apply: !input.dry_run },
	);
	return {
		schema_version: result.schema_version,
		dry_run: input.dry_run,
		results: result.results.map(toTemplateReconcileSummary),
	};
}

async function listTemplatesForReconcile(
	client: Pick<ListmonkClient, "template">,
): Promise<Template[]> {
	// Listmonk 6.2 GetTemplates returns Core.GetTemplates directly and ignores
	// page/per_page. The SDK wraps that exhaustive array with synthetic list
	// metadata, so following the metadata as pagination would repeat the same
	// records rather than discover additional templates.
	const response = await client.template.list({ query: { no_body: true } });
	const data = unwrapResourceResponse(
		response,
		"Failed to list templates for reconcile",
	);
	return data.results ?? [];
}

function templateMatchesDesiredState(
	template: Template,
	desired: z.output<typeof createTemplateInputSchema>,
): boolean {
	return (
		template.name === desired.name &&
		template.type === desired.type &&
		(template.subject ?? "") === desired.subject &&
		// Listmonk 6.2 validates syntax without rewriting the body before it
		// persists the supplied value, so body remains an exact managed field.
		(template.body ?? "") === desired.body &&
		// Omitted or empty body_source is unmanaged: Listmonk preserves the
		// current value when its update request leaves this field absent or empty.
		(desired.body_source === undefined ||
			desired.body_source === "" ||
			(template.body_source ?? "") === desired.body_source)
	);
}

// Mirrors Listmonk's shared server-side rejection for deleting a missing
// template and the protected default template; update if upstream rewords it.
const NONEXISTENT_OR_DEFAULT_TEMPLATE_MESSAGE = /non-existent or default template/i;

function isTemplateNonexistentOrDefaultError(error: unknown): boolean {
	return (
		error instanceof ResourceResponseError &&
		error.status === 400 &&
		NONEXISTENT_OR_DEFAULT_TEMPLATE_MESSAGE.test(error.message)
	);
}

export async function deleteTemplate(
	{ client }: TemplateOperationContext,
	input: z.output<typeof templateIdInputSchema>,
): Promise<z.output<typeof deleteTemplateOutputSchema>> {
	try {
		const response = await client.template.delete({ path: { id: input.id } });
		return {
			id: input.id,
			deleted: unwrapResourceResponse(response, "Failed to delete template"),
		};
	} catch (error) {
		if (!isTemplateNonexistentOrDefaultError(error)) {
			throw error;
		}
		// Listmonk reports one message for a missing template and for the
		// protected default template; only a genuinely missing template is a
		// delete no-op, so probe existence and treat anything but a clean
		// not-found (including transient probe failures) as an explicit error.
		try {
			await getTemplate({ client }, { id: input.id });
		} catch (probeError) {
			if (isResourceMissingError(probeError)) {
				return { id: input.id, deleted: false };
			}
		}
		throw error;
	}
}

export async function setDefaultTemplate(
	{ client }: TemplateOperationContext,
	input: z.output<typeof templateIdInputSchema>,
): Promise<z.output<typeof setDefaultTemplateOutputSchema>> {
	const response = await client.template.setAsDefault({
		path: { id: input.id },
	});
	// Listmonk 6.2 acknowledges this endpoint with an array even though its
	// upstream OpenAPI document declares a Template. Keep that transport detail
	// at the boundary and expose the stable requested-ID acknowledgement instead.
	unwrapResourceResponse(response, "Failed to set default template");
	return { id: input.id, set_default: true };
}

export const getTemplatesOperation = defineOperation({
	id: "templates.list",
	title: "List templates",
	description: "Get templates from Listmonk",
	inputSchema: templateListInputSchema,
	outputSchema: templateListOutputSchema,
	safety: readResourceSafety,
	mcp: { name: "listmonk_get_templates", legacySuccessText: jsonResourceValue },
	spec: bindTemplatesListOperationSpec(),
	execute: listTemplates,
});

export const getTemplateOperation = defineOperation({
	id: "templates.get",
	title: "Get template",
	description: "Get a template by ID",
	inputSchema: templateIdInputSchema,
	outputSchema: templateSchema,
	safety: readResourceSafety,
	mcp: { name: "listmonk_get_template", legacySuccessText: jsonResourceValue },
	spec: bindTemplatesGetOperationSpec(),
	execute: getTemplate,
});

export const createTemplateOperation = defineOperation({
	id: "templates.create",
	title: "Create template",
	description: "Create a template in Listmonk",
	inputSchema: createTemplateInputSchema,
	outputSchema: templateCreateOutputSchema,
	safety: createResourceSafety,
	mcp: {
		name: "listmonk_create_template",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindTemplatesCreateOperationSpec(),
	execute: createTemplate,
});

export const updateTemplateOperation = defineOperation({
	id: "templates.update",
	title: "Update template",
	description: "Update a template in Listmonk",
	inputSchema: updateTemplateInputSchema,
	outputSchema: templateSchema,
	safety: updateResourceSafety,
	mcp: {
		name: "listmonk_update_template",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindTemplatesUpdateOperationSpec(),
	execute: updateTemplate,
});

export const deleteTemplateOperation = defineOperation({
	id: "templates.delete",
	title: "Delete template",
	description: "Delete a template from Listmonk",
	inputSchema: templateIdInputSchema,
	outputSchema: deleteTemplateOutputSchema,
	safety: deleteResourceSafety,
	mcp: {
		name: "listmonk_delete_template",
		legacySuccessText: (output) =>
			output.deleted
				? "Template deleted successfully"
				: "Template already deleted",
	},
	spec: bindTemplatesDeleteOperationSpec(),
	execute: deleteTemplate,
});

export const setDefaultTemplateOperation = defineOperation({
	id: "templates.set-default",
	title: "Set default template",
	description: "Set a template as the Listmonk default",
	inputSchema: templateIdInputSchema,
	outputSchema: setDefaultTemplateOutputSchema,
	safety: updateResourceSafety,
	mcp: {
		name: "listmonk_set_default_template",
		legacySuccessText: "Default template set successfully",
	},
	spec: bindTemplatesSetDefaultOperationSpec(),
	execute: setDefaultTemplate,
});

export const reconcileTemplateManifestOperation = defineOperation({
	id: TEMPLATE_MANIFEST_OPERATION_ID,
	title: "Reconcile template manifest",
	description:
		"Plan or apply a versioned template manifest against exact-name Listmonk templates",
	inputSchema: templateManifestOperationInputSchema,
	outputSchema: templateManifestOperationOutputSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: true,
		openWorldHint: true,
	},
	mcp: {
		name: "listmonk_reconcile_template_manifest",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindTemplatesReconcileOperationSpec(),
	parseInput: parseTemplateManifestOperationInput,
	normalizeError: normalizeTemplateManifestOperationError,
	execute: executeTemplateManifestReconcile,
});

export async function invokeGetTemplatesOperation(
	context: TemplateOperationContext,
	input: unknown,
): Promise<TemplateListPage> {
	const parsedInput = parseOperationInput(
		getTemplatesOperation.inputSchema,
		input,
	);
	let output: TemplateListPage;
	try {
		output = await listTemplates(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(getTemplatesOperation.id, error);
	}
	return parseOperationOutput(
		getTemplatesOperation.id,
		getTemplatesOperation.outputSchema,
		output,
	);
}

export async function invokeGetTemplateOperation(
	context: TemplateOperationContext,
	input: unknown,
): Promise<z.output<typeof templateSchema>> {
	const parsedInput = parseOperationInput(
		getTemplateOperation.inputSchema,
		input,
	);
	let output: z.output<typeof templateSchema>;
	try {
		output = await getTemplate(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(getTemplateOperation.id, error);
	}
	return parseOperationOutput(
		getTemplateOperation.id,
		getTemplateOperation.outputSchema,
		output,
	);
}

export async function invokeCreateTemplateOperation(
	context: TemplateOperationContext,
	input: unknown,
): Promise<z.output<typeof templateCreateOutputSchema>> {
	const parsedInput = parseOperationInput(
		createTemplateOperation.inputSchema,
		input,
	);
	let output: TemplateCreateResult;
	try {
		output = await createTemplate(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(createTemplateOperation.id, error);
	}
	return parseOperationOutput(
		createTemplateOperation.id,
		createTemplateOperation.outputSchema,
		output,
	);
}

export async function invokeUpdateTemplateOperation(
	context: TemplateOperationContext,
	input: unknown,
): Promise<z.output<typeof templateSchema>> {
	const parsedInput = parseOperationInput(
		updateTemplateOperation.inputSchema,
		input,
	);
	let output: z.output<typeof templateSchema>;
	try {
		output = await updateTemplate(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(updateTemplateOperation.id, error);
	}
	return parseOperationOutput(
		updateTemplateOperation.id,
		updateTemplateOperation.outputSchema,
		output,
	);
}

export async function invokeDeleteTemplateOperation(
	context: TemplateOperationContext,
	input: unknown,
): Promise<z.output<typeof deleteTemplateOutputSchema>> {
	const parsedInput = parseOperationInput(
		deleteTemplateOperation.inputSchema,
		input,
	);
	let output: z.output<typeof deleteTemplateOutputSchema>;
	try {
		output = await deleteTemplate(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(deleteTemplateOperation.id, error);
	}
	return parseOperationOutput(
		deleteTemplateOperation.id,
		deleteTemplateOperation.outputSchema,
		output,
	);
}

export async function invokeSetDefaultTemplateOperation(
	context: TemplateOperationContext,
	input: unknown,
): Promise<z.output<typeof setDefaultTemplateOutputSchema>> {
	const parsedInput = parseOperationInput(
		setDefaultTemplateOperation.inputSchema,
		input,
	);
	let output: z.output<typeof setDefaultTemplateOutputSchema>;
	try {
		output = await setDefaultTemplate(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(
			setDefaultTemplateOperation.id,
			error,
		);
	}
	return parseOperationOutput(
		setDefaultTemplateOperation.id,
		setDefaultTemplateOperation.outputSchema,
		output,
	);
}

export async function invokeReconcileTemplateManifestOperation(
	context: TemplateOperationContext,
	input: unknown,
): Promise<TemplateManifestOperationResult> {
	const parsedInput = parseTemplateManifestOperationInput(input);
	let output: TemplateManifestOperationResult;
	try {
		output = await executeTemplateManifestReconcile(context, parsedInput);
	} catch (error) {
		throw normalizeTemplateManifestOperationError(error);
	}
	return parseOperationOutput(
		reconcileTemplateManifestOperation.id,
		reconcileTemplateManifestOperation.outputSchema,
		output,
	);
}

export const templateOperations = [
	getTemplatesOperation,
	getTemplateOperation,
	createTemplateOperation,
	updateTemplateOperation,
	deleteTemplateOperation,
	setDefaultTemplateOperation,
	reconcileTemplateManifestOperation,
] as const;

export const templateOperationCatalog = defineOperationCatalog({
	id: "templates",
	title: "Templates",
	operations: templateOperations,
	specMigrationExemptions: [],
});

export type TemplateOperation = (typeof templateOperations)[number];

const templateOperationsByMcpName = new Map<string, TemplateOperation>(
	templateOperations.map((operation) => [operation.mcp.name, operation]),
);

export function getTemplateOperationByMcpName(
	name: string,
): TemplateOperation | undefined {
	return templateOperationsByMcpName.get(name);
}

export interface TemplateOperationInvocation {
	operation: TemplateOperation;
	output: Record<string, unknown>;
}

export async function invokeTemplateOperationByMcpName(
	context: TemplateOperationContext,
	name: string,
	input: unknown,
): Promise<TemplateOperationInvocation | undefined> {
	switch (name) {
		case getTemplatesOperation.mcp.name:
			return {
				operation: getTemplatesOperation,
				output: await invokeGetTemplatesOperation(context, input),
			};
		case getTemplateOperation.mcp.name:
			return {
				operation: getTemplateOperation,
				output: await invokeGetTemplateOperation(context, input),
			};
		case createTemplateOperation.mcp.name:
			return {
				operation: createTemplateOperation,
				output: await invokeCreateTemplateOperation(context, input),
			};
		case updateTemplateOperation.mcp.name:
			return {
				operation: updateTemplateOperation,
				output: await invokeUpdateTemplateOperation(context, input),
			};
		case deleteTemplateOperation.mcp.name:
			return {
				operation: deleteTemplateOperation,
				output: await invokeDeleteTemplateOperation(context, input),
			};
		case setDefaultTemplateOperation.mcp.name:
			return {
				operation: setDefaultTemplateOperation,
				output: await invokeSetDefaultTemplateOperation(context, input),
			};
		case reconcileTemplateManifestOperation.mcp.name:
			return {
				operation: reconcileTemplateManifestOperation,
				output: await invokeReconcileTemplateManifestOperation(context, input),
			};
		default:
			return undefined;
	}
}
