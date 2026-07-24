import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	handleOperationCatalogTools,
	operationCatalogTools,
} from "../../src/handlers/catalog.js";
import {
	mcpOperationCatalog,
	listMcpOperationCatalogSummaries,
} from "../../src/operation-catalog.js";
import { connectMCPTransport } from "../../src/protocol.js";
import { createListmonkMCPServer } from "../../src/server.js";
import type { CallToolRequest } from "../../src/types/mcp.js";

const MCP_PACKAGE_DIRECTORY = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const PROJECT_ROOT = resolve(MCP_PACKAGE_DIRECTORY, "../..");
const CLI_DIRECTORY = resolve(PROJECT_ROOT, "apps/cli");
const CLI_ENTRY = resolve(CLI_DIRECTORY, "src/index.ts");

type CatalogOperation = {
	family: string;
	familyTitle: string;
	id: string;
	mcpName: string;
	title: string;
	description: string;
	inputSchema: Record<string, unknown>;
	outputSchema: Record<string, unknown>;
	safety: Record<string, boolean>;
	execution: {
		confirmationRequired: boolean;
		auditRequired: boolean;
		dryRunSupported: boolean;
	};
};

type CatalogOutput = {
	operations: CatalogOperation[];
};

function request(
	arguments_: Record<string, unknown> = {},
): CallToolRequest {
	return {
		method: "tools/call",
		params: { name: "listmonk_list_operations", arguments: arguments_ },
	};
}

function parseCatalogOutput(output: string): CatalogOutput {
	const jsonStart = output.indexOf("{");
	if (jsonStart < 0) {
		throw new Error(`Catalog command did not return JSON: ${output}`);
	}
	return JSON.parse(output.slice(jsonStart)) as CatalogOutput;
}

function runCliOperationCatalog(family: string): CatalogOutput {
	const result = Bun.spawnSync(
		["bun", CLI_ENTRY, "operations", "--family", family],
		{
			cwd: CLI_DIRECTORY,
			env: {
				...process.env,
				BUN_FORCE_COLOR: "0",
				LISTMONK_API_TOKEN: "",
			},
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const output = `${result.stdout.toString()}${result.stderr.toString()}`.trim();
	if (result.exitCode !== 0) {
		throw new Error(`Catalog CLI failed: ${output}`);
	}
	return parseCatalogOutput(output);
}

async function callMcpOperationCatalog(family: string): Promise<CatalogOutput> {
	const provider = createListmonkMCPServer({
		baseUrl: "http://127.0.0.1:9000/api",
		username: "api-admin",
		apiToken: "dummy-token",
	});
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const protocolServer = await connectMCPTransport(provider, serverTransport);
	const client = new Client({
		name: "listmonk-ops-catalog-parity-test",
		version: "1.0.0",
	});

	try {
		await client.connect(clientTransport);
		const result = await client.callTool({
			name: "listmonk_list_operations",
			arguments: { family },
		});
		if (result.isError) {
			throw new Error(`Catalog MCP call failed: ${result.content[0]?.text}`);
		}
		const structuredContent = result.structuredContent as CatalogOutput | undefined;
		if (!structuredContent) {
			throw new Error("Catalog MCP call did not return structured content");
		}
		expect(parseCatalogOutput(result.content[0]?.text ?? "")).toEqual(
			structuredContent,
		);
		return structuredContent;
	} finally {
		await client.close();
		await protocolServer.close();
	}
}

function stableCatalogFields(output: CatalogOutput) {
	return output.operations.map((operation) => ({
		family: operation.family,
		familyTitle: operation.familyTitle,
		id: operation.id,
		mcpName: operation.mcpName,
		title: operation.title,
		description: operation.description,
		inputSchema: operation.inputSchema,
		outputSchema: operation.outputSchema,
		safety: operation.safety,
		execution: operation.execution,
	}));
}

describe("operation catalog MCP adapter", () => {
	test("publishes a read-only discovery tool for every shared operation", async () => {
		expect(operationCatalogTools).toHaveLength(1);
		const catalogTool = operationCatalogTools[0];
		expect(catalogTool).toMatchObject({
			name: "listmonk_list_operations",
			outputSchema: {
				properties: {
					operations: {
						type: "array",
						items: {
							type: "object",
							properties: {
								execution: {
									type: "object",
								},
							},
						},
					},
				},
			},
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
			},
		});
		const outputSchema = catalogTool?.outputSchema as {
			properties?: {
				operations?: {
					items?: {
						properties?: {
							execution?: { required?: string[] };
						};
						required?: string[];
					};
				};
			};
		};
		const operationItemSchema = outputSchema.properties?.operations?.items;
		expect(operationItemSchema?.required).toContain("execution");
		expect(operationItemSchema?.properties?.execution?.required).toEqual([
			"confirmationRequired",
			"auditRequired",
			"dryRunSupported",
		]);
		expect(mcpOperationCatalog.entries).toHaveLength(47);
		expect(listMcpOperationCatalogSummaries("ops")).toHaveLength(9);
		expect(listMcpOperationCatalogSummaries("media")).toHaveLength(3);

		const result = await handleOperationCatalogTools(request({ family: "lists" }), {} as never);
		expect(result.isError).not.toBe(true);
		expect(result.structuredContent?.operations).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					family: "lists",
					mcpName: "listmonk_get_lists",
					execution: {
						confirmationRequired: false,
						auditRequired: false,
						dryRunSupported: false,
					},
				}),
			]),
		);
		expect(JSON.parse(result.content[0]?.text ?? "null")).toEqual(
			result.structuredContent,
		);
	});

	test("rejects invalid discovery input and unknown tools", async () => {
		const invalid = await handleOperationCatalogTools(
			request({ family: " " }),
			{} as never,
		);
		expect(invalid.isError).toBe(true);
		expect(invalid.content[0]?.text).toContain("Invalid parameter family");

		const unknown = await handleOperationCatalogTools(
			{
				method: "tools/call",
				params: { name: "listmonk_unknown_catalog_tool", arguments: {} },
			},
			{} as never,
		);
		expect(unknown.isError).toBe(true);
		expect(unknown.content[0]?.text).toContain("Unknown tool");
	});

	test("keeps catalog output in parity at CLI and MCP boundaries", async () => {
		// Catalog discovery is pure metadata and intentionally does not contact
		// Listmonk. Compose/Mailpit parity is reserved for side-effecting flows.
		const cliOutput = runCliOperationCatalog("campaigns");
		const mcpOutput = await callMcpOperationCatalog("campaigns");

		expect(cliOutput.operations).toHaveLength(5);
		expect(stableCatalogFields(cliOutput)).toEqual(
			stableCatalogFields(mcpOutput),
		);
	});
});
