import { describe, expect, test } from "bun:test";
import {
	assertArchitectureCallPaths,
	type CallPathContract,
	type GraphDump,
} from "./check-graph-architecture";

const contract: CallPathContract = {
	label: "sample architecture path",
	path: ["entry", "operation", "client"],
};

describe("graph architecture contract", () => {
	test("accepts a complete direct call path", () => {
		const graph: GraphDump = {
			nodes: [{ id: "entry" }, { id: "operation" }, { id: "client" }],
			edges: [
				{ from: "entry", to: "operation", kind: "calls" },
				{ from: "operation", to: "client", kind: "calls" },
			],
		};

		expect(() => assertArchitectureCallPaths(graph, [contract])).not.toThrow();
	});

	test("rejects missing nodes and non-call relationships", () => {
		const graph: GraphDump = {
			nodes: [{ id: "entry" }, { id: "operation" }],
			edges: [{ from: "entry", to: "operation", kind: "accesses" }],
		};

		try {
			assertArchitectureCallPaths(graph, [contract]);
			expect.unreachable("expected the graph architecture contract to fail");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			expect(message).toContain("missing node client");
			expect(message).toContain("missing call edge entry -> operation");
			expect(message).not.toContain("missing call edge operation -> client");
		}
	});
});
