import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import {
	renderStartSubscriberImport,
	renderSubscriberImportStatus,
	renderStopSubscriberImport,
	type SubscriberImportCliContext,
} from "../src/commands/subscribers";

function output() {
	return {
		info: mock(() => undefined),
		json: mock(() => undefined),
		success: mock(() => undefined),
		table: mock(() => undefined),
		warning: mock(() => undefined),
	};
}

describe("subscriber import CLI actions", () => {
	test("starts an import through the shared operation", async () => {
		const start = mock(async () => ({
			data: { name: "import.csv", total: 0, imported: 0, status: "importing" },
		}));
		const cliContext = {
			client: { import: { start } } as unknown as Pick<
				ListmonkClient,
				"import"
			>,
			output: output(),
		} satisfies SubscriberImportCliContext;

		await renderStartSubscriberImport(cliContext, {
			mode: "subscribe",
			delim: ",",
			lists: [1],
			overwrite: false,
			csv: "email,name\na@example.com,A\n",
		});

		expect(cliContext.output.success).toHaveBeenCalledWith(
			"Subscriber import started (importing)",
		);
	});

	test("renders and stops the import status", async () => {
		const get = mock(async () => ({
			data: { name: "import.csv", total: 3, imported: 2, status: "importing" },
		}));
		const stop = mock(async () => ({
			data: { name: "", total: 0, imported: 0, status: "none" },
		}));
		const cliContext = {
			client: { import: { get, stop } } as unknown as Pick<
				ListmonkClient,
				"import"
			>,
			output: output(),
		} satisfies SubscriberImportCliContext;

		await renderSubscriberImportStatus(cliContext);
		expect(cliContext.output.info).toHaveBeenCalledWith(
			"Subscriber import: importing (2/3)",
		);

		await renderStopSubscriberImport(cliContext);
		expect(cliContext.output.success).toHaveBeenCalledWith(
			"Subscriber import stopped (none)",
		);
	});
});
