import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import { invokeDeleteTemplateOperation, templateOperations } from "../src";

type TemplateClient = Pick<ListmonkClient, "template">;

function context(template: Partial<TemplateClient["template"]>) {
	return { client: { template } as TemplateClient };
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
