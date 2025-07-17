import { createListmonkMCPServer } from "../src/server.js";
import type { CallToolRequest, CallToolResult } from "../src/types/mcp.js";
import { TEST_CONFIG } from "./setup.js";

/**
 * MCP Test Client - simulates how an MCP client would call tools
 */
export class MCPTestClient {
	private server: ReturnType<typeof createListmonkMCPServer>;

	constructor() {
		this.server = createListmonkMCPServer({
			baseUrl: TEST_CONFIG.baseUrl,
			username: TEST_CONFIG.username,
			password: TEST_CONFIG.password,
			apiToken: TEST_CONFIG.apiToken,
		});
	}

	/**
	 * Call an MCP tool with given arguments
	 */
	async callTool(
		toolName: string,
		args: Record<string, unknown> = {},
	): Promise<CallToolResult> {
		const request: CallToolRequest = {
			method: "tools/call",
			params: {
				name: toolName,
				arguments: args,
			},
		};

		try {
			const result = await this.server.callTool(request);
			console.log(
				`🔧 Tool ${toolName} result:`,
				JSON.stringify(result, null, 2),
			);
			return result;
		} catch (error) {
			console.error(`❌ Tool ${toolName} error:`, error);
			return {
				content: [{ type: "text", text: `Error calling tool: ${error}` }],
				isError: true,
			};
		}
	}

	/**
	 * List available tools
	 */
	async listTools() {
		try {
			const request = {
				method: "tools/list" as const,
			};
			const result = await this.server.listTools(request);
			console.log(`📋 Available tools: ${result.tools?.length || 0}`);
			return result;
		} catch (error) {
			console.error(`❌ Error listing tools:`, error);
			throw error;
		}
	}

	/**
	 * Get server info
	 */
	async getServerInfo() {
		return {
			name: "listmonk-mcp-server",
			version: "0.1.0",
		};
	}
}

/**
 * Test utilities for MCP operations
 */
export class MCPTestUtils {
	constructor(private client: MCPTestClient) {}

	/**
	 * Assert that a tool call was successful
	 */
	assertSuccess<T = any>(result: CallToolResult, message?: string): T {
		if (result.isError) {
			const errorText = result.content?.[0]?.text || "Unknown error";
			throw new Error(message ? `${message}: ${errorText}` : errorText);
		}

		const contentText = result.content?.[0]?.text;
		if (!contentText) {
			throw new Error("No content in successful result");
		}

		try {
			return JSON.parse(contentText);
		} catch {
			// Return as string if not JSON
			return contentText as T;
		}
	}

	/**
	 * Assert that a tool call failed with expected error
	 */
	assertError(result: CallToolResult, expectedMessage?: string): string {
		if (!result.isError) {
			throw new Error("Expected error but got success");
		}

		const errorText = result.content?.[0]?.text || "";
		if (expectedMessage && !errorText.includes(expectedMessage)) {
			throw new Error(
				`Expected error message to contain "${expectedMessage}" but got: ${errorText}`,
			);
		}

		return errorText;
	}

	/**
	 * Create a test list
	 */
	async createTestList(name: string = "Test-List") {
		const result = await this.client.callTool("listmonk_create_list", {
			name: `${name}-${Date.now()}`,
			type: "private",
			description: "Test list created by E2E tests",
		});

		return this.assertSuccess(result, "Failed to create test list");
	}

	/**
	 * Create a test subscriber
	 */
	async createTestSubscriber(
		email: string = "test@example.com",
		name: string = "Test User",
	) {
		const result = await this.client.callTool("listmonk_create_subscriber", {
			email: `${Date.now()}.${email}`,
			name: `${name} ${Date.now()}`,
			status: "enabled",
		});

		return this.assertSuccess(result, "Failed to create test subscriber");
	}

	/**
	 * Create a test template
	 */
	async createTestTemplate(name: string = "Test-Template") {
		const result = await this.client.callTool("listmonk_create_template", {
			name: `${name}-${Date.now()}`,
			body: "<h1>Test Template</h1><p>This is a test template created by E2E tests.</p>",
			type: "campaign",
			subject: "Test Template Subject",
		});

		return this.assertSuccess(result, "Failed to create test template");
	}

	/**
	 * Wait for a condition to be true
	 */
	async waitFor(
		condition: () => Promise<boolean>,
		timeout: number = 10000,
		interval: number = 500,
	): Promise<void> {
		const start = Date.now();

		while (Date.now() - start < timeout) {
			if (await condition()) {
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, interval));
		}

		throw new Error(`Condition not met within ${timeout}ms`);
	}
}

/**
 * Create a test client and utils
 */
export function createMCPTestSuite() {
	const client = new MCPTestClient();
	const utils = new MCPTestUtils(client);

	return { client, utils };
}
