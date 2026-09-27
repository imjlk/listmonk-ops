import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import {
	invokeReadSystemAboutOperation,
	invokeReadSystemLogsOperation,
	invokeReloadSystemOperation,
	reloadSystemOperation,
	systemOperationCatalog,
	systemOperations,
	getSystemOperationByMcpName,
	invokeSystemOperationByMcpName,
} from "../src/system";
import { getOperationExecutionPolicy } from "../src/execution-policy";
import { OperationExecutionError } from "../src/operation";

type SystemClient = Pick<ListmonkClient, "system">;

function systemContext(
	methods: Partial<SystemClient["system"]>,
): { client: SystemClient } {
	return { client: { system: methods } as SystemClient };
}

describe("shared system operations", () => {
	test("exposes a read-only registry with safety metadata", () => {
		expect(systemOperations).toHaveLength(3);
		expect(systemOperationCatalog.id).toBe("system");
		for (const operation of systemOperations) {
			// Listmonk 6.2 applies settings by re-executing its process, which
			// interrupts running campaigns and drops queued transactional
			// messages, so every reload is a destructive, non-idempotent
			// restart.
			if (operation.id === "system.reload") {
				expect(operation.safety).toEqual({
					readOnlyHint: false,
					destructiveHint: true,
					idempotentHint: false,
					openWorldHint: true,
				});
			} else {
				expect(operation.safety).toEqual({
					readOnlyHint: true,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: true,
				});
			}
		}
		expect(getSystemOperationByMcpName("listmonk_get_logs")).toBe(
			systemOperations[1],
		);
			expect(getSystemOperationByMcpName("listmonk_reload_app")).toBe(
			systemOperations[2],
		);
		expect(getSystemOperationByMcpName("listmonk_unknown")).toBe(undefined);
	});

	test("declares the reload as a confirmation-gated, unsafe-to-repeat restart", async () => {
		expect(reloadSystemOperation.spec).toMatchObject({
			title: "Restart Listmonk to apply settings",
			effects: [
				{
					kind: "maintenance",
					resource: "system",
					action: "restart",
					destructive: true,
					preview: false,
				},
			],
			policy: { confirmation: "required", audit: "required", dryRun: false },
			retry: { kind: "unsafe" },
		});
		expect(reloadSystemOperation.description).toContain(
			"interrupting running campaigns",
		);
		expect(getOperationExecutionPolicy(reloadSystemOperation)).toEqual({
			confirmationRequired: true,
			auditRequired: true,
			dryRunSupported: false,
		});

		const reload = mock(async () => ({ data: true }));
		await expect(
			invokeReloadSystemOperation(
				systemContext({ reload: reload as SystemClient["system"]["reload"] }),
				{},
			),
		).resolves.toEqual({ reloaded: true });
		expect(reload).toHaveBeenCalledTimes(1);

		const refused = mock(async () => ({ data: false }));
		await expect(
			invokeReloadSystemOperation(
				systemContext({ reload: refused as SystemClient["system"]["reload"] }),
				{},
			),
		).rejects.toThrow(
			"Failed to request a Listmonk restart: Listmonk returned a negative acknowledgement",
		);
	});

	test("reads the build identity as observed", async () => {
		const getAbout = mock(async () => ({
			data: {
				version: "v6.2.0",
				build: "v6.2.0 (ef0a7587)",
				go_version: "go1.26.1",
				go_arch: "arm64",
			},
		}));

		await expect(
			invokeReadSystemAboutOperation(
				systemContext({
					getAbout: getAbout as SystemClient["system"]["getAbout"],
				}),
				{},
			),
		).resolves.toMatchObject({ version: "v6.2.0", go_arch: "arm64" });
		expect(getAbout).toHaveBeenCalledTimes(1);
	});

	test("reads server log lines through the shared operation", async () => {
		const getLogs = mock(async () => ({
			data: ["line one", "line two"],
		}));

		await expect(
			invokeReadSystemLogsOperation(
				systemContext({
					getLogs: getLogs as SystemClient["system"]["getLogs"],
				}),
				{},
			),
		).resolves.toEqual({ logs: ["line one", "line two"] });
	});

	test("returns empty logs for a non-array payload", async () => {
		const getLogs = mock(async () => ({ data: undefined }));
		await expect(
			invokeReadSystemLogsOperation(
				systemContext({
					getLogs: getLogs as unknown as SystemClient["system"]["getLogs"],
				}),
				{},
			),
		).rejects.toThrow("Failed to read server logs");
	});

	test("dispatches MCP names through the named operations", async () => {
		const getAbout = mock(async () => ({ data: { version: "v6.2.0" } }));
		const context = systemContext({
			getAbout: getAbout as SystemClient["system"]["getAbout"],
		});

		await expect(
			invokeSystemOperationByMcpName(context, "listmonk_get_about", {}),
		).resolves.toMatchObject({
			operation: systemOperations[0],
			output: { version: "v6.2.0" },
		});
		await expect(
			invokeSystemOperationByMcpName(context, "listmonk_unknown", {}),
		).resolves.toBe(undefined);
	});

	test("surfaces transport failures through the operation error contract", async () => {
		const getAbout = mock(async () => ({
			error: "invalid API credentials",
			response: { status: 403 },
		}));
		const error = await invokeReadSystemAboutOperation(
			systemContext({
				getAbout: getAbout as unknown as SystemClient["system"]["getAbout"],
			}),
			{},
		).catch((failure: unknown) => failure);
		expect(error).toBeInstanceOf(OperationExecutionError);
		expect(error).toHaveProperty("operationId", "system.about");
	});
});
