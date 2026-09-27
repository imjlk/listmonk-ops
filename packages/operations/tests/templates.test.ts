import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import { z } from "zod";
import {
	invokeDeleteTemplateOperation,
	invokeReconcileTemplateManifestOperation,
	OperationExecutionError,
	OperationInputError,
	planTemplateReconcile,
	reconcileTemplate,
	reconcileTemplateManifest,
	reconcileTemplateManifestOperation,
	templateOperations,
} from "../src";
import { createListmonk62TemplateStore } from "./helpers/listmonk-template-store";

type TemplateClient = Pick<ListmonkClient, "template">;

function context(template: Partial<TemplateClient["template"]>) {
	return { client: { template } as TemplateClient };
}

const CAMPAIGN_LAYOUT = '<html><body>{{ template "content" . }}</body></html>';

function releaseManifest(version: string) {
	return {
		schema_version: 1 as const,
		templates: [
			{
				name: "Newsletter layout",
				type: "campaign" as const,
				body: `<!-- ${version} -->${CAMPAIGN_LAYOUT}`,
			},
			{
				name: "Visual layout",
				type: "campaign_visual" as const,
				body: `<p>Visual ${version}</p>`,
				body_source: `{"version":"${version}"}`,
			},
			{
				name: "Account sign-in code",
				type: "tx" as const,
				subject: `Your sign-in code (${version})`,
				body: `<p>${version}: {{ .Tx.Data.code }}</p>`,
			},
		],
	};
}

describe("template operations", () => {
	test("treats deleting an already-deleted template as a no-op", async () => {
		const remove = mock(async () => ({
			error: { message: "Cannot delete non-existent or default template" },
			response: { status: 400 },
		})) as unknown as TemplateClient["template"]["delete"];
		const getById = mock(async () => ({
			error: { message: "template not found" },
			response: { status: 404 },
		})) as unknown as TemplateClient["template"]["getById"];

		const output = await invokeDeleteTemplateOperation(
			context({ delete: remove, getById }),
			{ id: 999 },
		);

		expect(output).toEqual({ id: 999, deleted: false });
		expect(remove).toHaveBeenCalledWith({ path: { id: 999 } });
		expect(getById).toHaveBeenCalledWith({ path: { id: 999 } });
	});

	test("recognizes Listmonk 6.2's 400 template-not-found probe", async () => {
		const remove = mock(async () => ({
			error: { message: "Cannot delete non-existent or default template" },
			response: { status: 400 },
		})) as unknown as TemplateClient["template"]["delete"];
		// Listmonk 6.2 answers GET /templates/{missing} with 400, not 404.
		const getById = mock(async () => ({
			error: { message: "Template not found" },
			response: { status: 400 },
		})) as unknown as TemplateClient["template"]["getById"];

		await expect(
			invokeDeleteTemplateOperation(context({ delete: remove, getById }), {
				id: 998,
			}),
		).resolves.toEqual({ id: 998, deleted: false });

		// A 400 about another missing entity is not this template's miss.
		const otherEntity = mock(async () => ({
			error: { message: "List not found" },
			response: { status: 400 },
		})) as unknown as TemplateClient["template"]["getById"];
		await expect(
			invokeDeleteTemplateOperation(
				context({ delete: remove, getById: otherEntity }),
				{ id: 998 },
			),
		).rejects.toThrow(/non-existent or default template/);

		// A 404 that does not name the template (a proxy or misrouted request)
		// cannot prove the template is gone.
		const proxyMiss = mock(async () => ({
			error: { message: "404 page not found" },
			response: { status: 404 },
		})) as unknown as TemplateClient["template"]["getById"];
		await expect(
			invokeDeleteTemplateOperation(
				context({ delete: remove, getById: proxyMiss }),
				{ id: 998 },
			),
		).rejects.toThrow(/non-existent or default template/);

		// Any other 400 from the probe keeps the explicit error.
		const invalid = mock(async () => ({
			error: { message: "Invalid ID" },
			response: { status: 400 },
		})) as unknown as TemplateClient["template"]["getById"];
		await expect(
			invokeDeleteTemplateOperation(
				context({ delete: remove, getById: invalid }),
				{ id: 998 },
			),
		).rejects.toThrow(/non-existent or default template/);
	});

	test("still rejects deleting the protected default template", async () => {
		const remove = mock(async () => ({
			error: { message: "Cannot delete non-existent or default template" },
			response: { status: 400 },
		})) as unknown as TemplateClient["template"]["delete"];
		const getById = mock(async () => ({
			data: { id: 1, name: "Default", type: "campaign" },
		})) as unknown as TemplateClient["template"]["getById"];

		await expect(
			invokeDeleteTemplateOperation(
				context({ delete: remove, getById }),
				{ id: 1 },
			),
		).rejects.toThrow(/non-existent or default template/);
	});

	test("publishes the delete with idempotent safety metadata", () => {
		expect(
			templateOperations.find(
				(operation) => operation.id === "templates.delete",
			)?.safety.idempotentHint,
		).toBe(true);
	});
});

describe("template manifest reconciliation against Listmonk 6.2 persistence", () => {
	test("publishes type-dependent subject constraints in the operation schema", () => {
		const schema = z.toJSONSchema(reconcileTemplateManifestOperation.inputSchema, {
			io: "input",
		}) as {
			properties?: {
					templates?: {
					items?: {
						anyOf?: Array<{
							properties?: Record<
								string,
								{ const?: string; maxLength?: number; pattern?: string }
							>;
							required?: string[];
						}>;
						oneOf?: Array<{
							properties?: Record<
								string,
								{ const?: string; maxLength?: number; pattern?: string }
							>;
							required?: string[];
						}>;
					};
				};
			};
		};
		const itemSchema = schema.properties?.templates?.items;
		const variants = itemSchema?.oneOf ?? itemSchema?.anyOf ?? [];
		const campaign = variants.find(
			(variant) => variant.properties?.type?.const === "campaign",
		);
		const tx = variants.find(
			(variant) => variant.properties?.type?.const === "tx",
		);

		expect(variants).toHaveLength(3);
		expect(campaign?.properties?.subject?.pattern).toBe("^$");
		expect(campaign?.properties?.name?.pattern).toBe(
			"^\\s*\\S[\\s\\S]*$",
		);
		expect(campaign?.properties?.name?.maxLength).toBe(120);
		expect(tx?.properties?.subject?.pattern).toBe("^\\s*\\S[\\s\\S]*$");
		expect(tx?.required).toContain("subject");
		expect(
			reconcileTemplateManifestOperation.inputSchema.safeParse({
				schema_version: 1,
				templates: [
					{
						name: "Newsletter layout",
						type: "campaign",
						subject: "   ",
						body: CAMPAIGN_LAYOUT,
					},
				],
			}).success,
		).toBe(false);
		expect(
			reconcileTemplateManifestOperation.inputSchema.safeParse({
				schema_version: 1,
				templates: [
					{
						name: "   ",
						type: "campaign",
						body: CAMPAIGN_LAYOUT,
					},
				],
			}).success,
		).toBe(false);
	});

	test("keeps runtime and published subject rules in sync for every template type", async () => {
		const list = mock(async () => ({ data: { results: [], total: 0 } }));
		const templateContext = context({
			list: list as unknown as TemplateClient["template"]["list"],
		});
		const cases = [
			{ subject: undefined, expected: true },
			{ type: "campaign", subject: "", expected: true },
			{ type: "campaign", subject: "   ", expected: false },
			{ type: "campaign", subject: "Monthly newsletter", expected: false },
			{ type: "campaign_visual", subject: undefined, expected: true },
			{ type: "campaign_visual", subject: "", expected: true },
			{ type: "campaign_visual", subject: "   ", expected: false },
			{ type: "campaign_visual", subject: "Visual title", expected: false },
			{ type: "tx", subject: undefined, expected: false },
			{ type: "tx", subject: "", expected: false },
			{ type: "tx", subject: "   ", expected: false },
			{ type: "tx", subject: "One-time code", expected: true },
		] as const;

		for (const [index, rule] of cases.entries()) {
			const template = {
				name: `Subject matrix ${index}`,
				...(rule.type === undefined ? {} : { type: rule.type }),
				...(rule.subject === undefined ? {} : { subject: rule.subject }),
				body: CAMPAIGN_LAYOUT,
			};
			const manifest = { schema_version: 1 as const, templates: [template] };
			const schemaAccepts = reconcileTemplateManifestOperation.inputSchema.safeParse(
				manifest,
			).success;
			const runtimeAccepts = await reconcileTemplateManifest(
				templateContext,
				manifest,
			)
				.then(() => true)
				.catch(() => false);

			expect(schemaAccepts).toBe(rule.expected);
			expect(runtimeAccepts).toBe(schemaAccepts);
		}
	});

	test("rejects raw template names beyond the published length limit", async () => {
		const list = mock(async () => ({ data: { results: [], total: 0 } }));
		const templateContext = context({
			list: list as unknown as TemplateClient["template"]["list"],
		});
		const name = `  ${"a".repeat(119)}`;
		const manifest = {
			schema_version: 1 as const,
			templates: [{ name, type: "campaign" as const, body: CAMPAIGN_LAYOUT }],
		};

		expect(name).toHaveLength(121);
		expect(name.trim()).toHaveLength(119);
		expect(
			reconcileTemplateManifestOperation.inputSchema.safeParse(manifest).success,
		).toBe(false);
		await expect(
			reconcileTemplateManifest(templateContext, manifest),
		).rejects.toThrow();
		expect(list).not.toHaveBeenCalled();
	});

	test("re-plans an applied manifest as unchanged across every template type", async () => {
		const listmonk = createListmonk62TemplateStore();
		const templateContext = { client: { template: listmonk.template } };
		const manifest = releaseManifest("v1");

		await expect(
			reconcileTemplateManifest(templateContext, manifest, { apply: true }),
		).resolves.toMatchObject({
			apply: true,
			results: [
				{ name: "Newsletter layout", action: "create", applied: true },
				{ name: "Visual layout", action: "create", applied: true },
				{ name: "Account sign-in code", action: "create", applied: true },
			],
		});

		await expect(
			invokeReconcileTemplateManifestOperation(templateContext, manifest),
		).resolves.toEqual({
			schema_version: 1,
			dry_run: true,
			results: [
				{ name: "Newsletter layout", action: "unchanged", applied: false },
				{ name: "Visual layout", action: "unchanged", applied: false },
				{ name: "Account sign-in code", action: "unchanged", applied: false },
			],
		});
		expect(listmonk.mutations).toEqual({ create: 3, update: 0 });
	});

	test("converges after Listmonk rewrites an updated campaign subject to the prior name", async () => {
		const listmonk = createListmonk62TemplateStore();
		const templateContext = { client: { template: listmonk.template } };
		await reconcileTemplateManifest(templateContext, releaseManifest("v1"), {
			apply: true,
		});

		const next = releaseManifest("v2");
		await expect(
			invokeReconcileTemplateManifestOperation(templateContext, {
				...next,
				dry_run: false,
			}),
		).resolves.toEqual({
			schema_version: 1,
			dry_run: false,
			results: [
				{ name: "Newsletter layout", action: "update", applied: true },
				{ name: "Visual layout", action: "update", applied: true },
				{ name: "Account sign-in code", action: "update", applied: true },
			],
		});
		// The mirror stores what 6.2 stores: an updated campaign-type template
		// carries its previous name as the subject, while tx keeps its own.
		expect(listmonk.stored("Newsletter layout")?.subject).toBe(
			"Newsletter layout",
		);
		expect(listmonk.stored("Visual layout")?.subject).toBe("Visual layout");
		expect(listmonk.stored("Account sign-in code")?.subject).toBe(
			"Your sign-in code (v2)",
		);

		await expect(
			reconcileTemplateManifest(templateContext, next),
		).resolves.toMatchObject({
			apply: false,
			results: [
				{ action: "unchanged" },
				{ action: "unchanged" },
				{ action: "unchanged" },
			],
		});
		await expect(
			reconcileTemplateManifest(templateContext, next, { apply: true }),
		).resolves.toMatchObject({
			results: [
				{ action: "unchanged", applied: false },
				{ action: "unchanged", applied: false },
				{ action: "unchanged", applied: false },
			],
		});
		expect(listmonk.mutations).toEqual({ create: 3, update: 3 });
	});

	test("still plans a tx subject change as an update", async () => {
		const listmonk = createListmonk62TemplateStore();
		const templateContext = { client: { template: listmonk.template } };
		await reconcileTemplateManifest(templateContext, releaseManifest("v1"), {
			apply: true,
		});

		await expect(
			planTemplateReconcile(templateContext, {
				name: "Account sign-in code",
				type: "tx",
				subject: "A different subject",
				body: "<p>v1: {{ .Tx.Data.code }}</p>",
			}),
		).resolves.toMatchObject({ action: "update", applied: false });
	});

	test("rejects a subject on campaign-type entries before any remote read", async () => {
		const list = mock(async () => ({ data: { results: [], total: 0 } }));
		const templateContext = context({
			list: list as unknown as TemplateClient["template"]["list"],
		});

		for (const type of ["campaign", "campaign_visual"] as const) {
			const manifest = {
				schema_version: 1 as const,
				templates: [
					{
						name: "Newsletter layout",
						type,
						subject: "Monthly newsletter",
						body: CAMPAIGN_LAYOUT,
					},
				],
			};
			await expect(
				reconcileTemplateManifest(templateContext, manifest),
			).rejects.toThrow(`discards the subject of ${type} templates`);

			const failure = await invokeReconcileTemplateManifestOperation(
				templateContext,
				manifest,
			).catch((error: unknown) => error);
			expect(failure).toBeInstanceOf(OperationInputError);
			expect((failure as Error).message).toBe(
				`Invalid parameter templates.0.subject: Template subject is only supported for tx templates: Listmonk 6.2 discards the subject of ${type} templates, whose subject is set per campaign. Remove "subject" from this entry`,
			);

			await expect(
				reconcileTemplate(templateContext, manifest.templates[0]!),
			).rejects.toThrow("only supported for tx templates");
		}
		expect(list).not.toHaveBeenCalled();
	});

	test("rejects a blank tx subject before any remote read", async () => {
		const list = mock(async () => ({ data: { results: [], total: 0 } }));
		const templateContext = context({
			list: list as unknown as TemplateClient["template"]["list"],
		});
		const message =
			"Template subject is required for tx templates: Listmonk 6.2 rejects a transactional template without one";

		for (const subject of [undefined, "", "   "]) {
			const entry = {
				name: "Account sign-in code",
				type: "tx" as const,
				body: "<p>{{ .Tx.Data.code }}</p>",
				...(subject === undefined ? {} : { subject }),
			};
			const manifest = { schema_version: 1 as const, templates: [entry] };
			await expect(
				reconcileTemplateManifest(templateContext, manifest),
			).rejects.toThrow("required for tx templates");

			const failure = await invokeReconcileTemplateManifestOperation(
				templateContext,
				manifest,
			).catch((error: unknown) => error);
			expect(failure).toBeInstanceOf(OperationInputError);
			expect((failure as Error).message).toBe(
				`Invalid parameter templates.0.subject: ${message}`,
			);

			await expect(reconcileTemplate(templateContext, entry)).rejects.toThrow(
				"required for tx templates",
			);
		}
		expect(list).not.toHaveBeenCalled();
	});

	test("fails planning on a type change before any mutation", async () => {
		const listmonk = createListmonk62TemplateStore([
			{
				name: "Account sign-in code",
				type: "campaign",
				subject: "",
				body: CAMPAIGN_LAYOUT,
				body_source: null,
			},
		]);
		const templateContext = { client: { template: listmonk.template } };
		const manifest = {
			schema_version: 1 as const,
			templates: [
				{
					name: "Password reset code",
					type: "tx" as const,
					subject: "Reset your password",
					body: "<p>{{ .Tx.Data.link }}</p>",
				},
				{
					name: "Account sign-in code",
					type: "tx" as const,
					subject: "Your sign-in code",
					body: "<p>{{ .Tx.Data.code }}</p>",
				},
			],
		};
		const typeChange =
			'Template reconcile cannot change "Account sign-in code" from type "campaign" to "tx": Listmonk 6.2 never updates a template type, so delete the template and reconcile again to recreate it';

		await expect(
			reconcileTemplateManifest(templateContext, manifest),
		).rejects.toThrow(typeChange);
		await expect(
			reconcileTemplateManifest(templateContext, manifest, { apply: true }),
		).rejects.toThrow(typeChange);

		const failure = await invokeReconcileTemplateManifestOperation(
			templateContext,
			{ ...manifest, dry_run: false },
		).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(OperationExecutionError);
		expect((failure as Error).message).toBe(typeChange);
		// Planning covers the whole manifest before the first write, so the
		// valid entry ahead of the type change was not created either.
		expect(listmonk.mutations).toEqual({ create: 0, update: 0 });
	});
});
