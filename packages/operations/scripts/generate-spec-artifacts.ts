import { resolve } from "node:path";
import { emailOperationsSpec, type AnyOperationSpec } from "../src/specs";

const outputDirectory = resolve(import.meta.dir, "../generated/specs");
const checkOnly = Bun.argv.includes("--check");

function stableValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(stableValue);
	}
	if (typeof value === "object" && value !== null) {
		return Object.fromEntries(
			Object.entries(value)
				.filter(([, nested]) => nested !== undefined)
				.sort(([left], [right]) =>
					left < right ? -1 : left > right ? 1 : 0,
				)
				.map(([key, nested]) => [key, stableValue(nested)]),
		);
	}
	return value;
}

function stableJson(value: unknown): string {
	return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function markdownArtifact(value: string): string {
	return `${value.trimEnd()}\n`;
}

function renderEffects(operation: AnyOperationSpec): string {
	return operation.effects
		.map((effect) => {
			switch (effect.kind) {
				case "read":
					return `read:${effect.resource}`;
				case "write":
					return `write:${effect.resource}`;
				case "delivery":
					return `delivery:${effect.audience}:${effect.timing}`;
				case "suppression":
					return `suppression:${effect.scope}`;
				case "delete":
					return `delete:${effect.resource}`;
				default: {
					const unhandled: never = effect;
					throw new Error(
						`Unhandled operation effect: ${JSON.stringify(unhandled)}`,
					);
				}
			}
		})
		.join(", ");
}

function renderOperationReference(): string {
	const sections = emailOperationsSpec.operations.map((operation) => {
		const transition = operation.state
			? `\n- State: \`${operation.state.from.join(" | ")} -> ${operation.state.to}\`${operation.state.allowNoopFromTarget ? " (target-state no-op allowed)" : ""}`
			: "";
		return [
			`## \`${operation.id}\``,
			"",
			operation.description,
			"",
			`- Resource / verb: \`${operation.resource}.${operation.verb}\``,
			`- MCP tool: \`${operation.projection.mcpName}\``,
			`- Effects: \`${renderEffects(operation)}\``,
			`- Policy: confirmation \`${operation.policy.confirmation}\`, audit \`${operation.policy.audit}\`, dry-run \`${String(operation.policy.dryRun)}\``,
			`- Retry: \`${operation.retry.kind}\``,
			`- Stability: \`${operation.stability}\` since \`${operation.since}\`${transition}`,
			"",
		].join("\n");
	});
	return [
		"# Email Operations Specification",
		"",
		"> Generated from `@listmonk-ops/operations/specs`. Do not edit manually.",
		"",
		...sections,
	].join("\n");
}

function renderAgentSkill(): string {
	const sections = emailOperationsSpec.operations.map((operation) => [
		`## ${operation.title} (\`${operation.id}\`)`,
		"",
		`Use when: ${operation.agent.useWhen.join(" ")}`,
		"",
		`Avoid when: ${operation.agent.avoidWhen.join(" ")}`,
		"",
		`Prerequisites: ${operation.agent.prerequisites.length === 0 ? "none" : operation.agent.prerequisites.map((id) => `\`${id}\``).join(", ")}`,
		"",
		`Verify with: ${operation.agent.verifyWith.length === 0 ? "none" : operation.agent.verifyWith.map((id) => `\`${id}\``).join(", ")}`,
		"",
		`Retry guidance: ${operation.agent.retryGuidance}`,
		"",
	].join("\n"));
	return [
		"# listmonk-ops agent operation reference",
		"",
		"> Generated from the Email Operations Specification. Runtime safety gates and explicit confirmation remain authoritative.",
		"",
		...sections,
	].join("\n");
}

const schemaSnapshot = {
	schemaVersion: emailOperationsSpec.schemaVersion,
	operations: emailOperationsSpec.operations.map((operation) => ({
		id: operation.id,
		input: operation.contract.input,
		output: operation.contract.output,
		policy: operation.policy,
		retry: operation.retry,
		stability: operation.stability,
		since: operation.since,
	})),
};

const graphExpectations = {
	schemaVersion: emailOperationsSpec.schemaVersion,
	operations: emailOperationsSpec.operations.map((operation) => ({
		operationId: operation.id,
		nodes: operation.projection.graph,
		edges: [
			{
				kind: "calls",
				from: operation.projection.graph.runtimeDefinitionNode,
				to: operation.projection.graph.bindingNode,
			},
			{
				kind: "type_ref",
				from: operation.projection.graph.bindingNode,
				to: operation.projection.graph.descriptorNode,
			},
			{
				kind: "calls",
				from: operation.projection.graph.invokerNode,
				to: operation.projection.graph.executorNode,
			},
		],
	})),
};

const artifacts = {
	"operations-spec.json": stableJson(emailOperationsSpec),
	"schema-snapshot.json": stableJson(schemaSnapshot),
	"graph-expectations.json": stableJson(graphExpectations),
	"operations.md": markdownArtifact(renderOperationReference()),
	"agent-skill.md": markdownArtifact(renderAgentSkill()),
};

for (const [fileName, expected] of Object.entries(artifacts)) {
	const path = resolve(outputDirectory, fileName);
	const current = await Bun.file(path).text().catch(() => undefined);
	if (checkOnly) {
		if (current !== expected) {
			throw new Error(
				`Generated operations-spec artifact ${fileName} is stale. Run \`bun run --cwd packages/operations generate:specs\`.`,
			);
		}
	} else {
		await Bun.write(path, expected);
	}
}
