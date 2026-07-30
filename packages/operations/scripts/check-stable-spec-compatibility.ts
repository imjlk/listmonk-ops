import { resolve } from "node:path";
import { emailOperationsSpec } from "../src/specs";

const baselinePath = resolve(
	import.meta.dir,
	"../generated/specs/stable-contract-baseline.json",
);
const accept = Bun.argv.includes("--accept");

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

const current = {
	baselineVersion: 1,
	operations: emailOperationsSpec.operations
		.filter((operation) => operation.stability === "stable")
		.map((operation) => ({
			id: operation.id,
			resource: operation.resource,
			verb: operation.verb,
			contract: operation.contract,
			effects: operation.effects,
			policy: operation.policy,
			retry: operation.retry,
			state: operation.state,
			mcpName: operation.projection.mcpName,
		})),
};
const expected = `${JSON.stringify(stableValue(current), null, 2)}\n`;

if (accept) {
	await Bun.write(baselinePath, expected);
	console.log(
		`Accepted ${current.operations.length} stable operation contracts.`,
	);
} else {
	const baseline = await Bun.file(baselinePath).text().catch(() => undefined);
	if (baseline !== expected) {
		throw new Error(
			"Stable operation contracts changed. Review compatibility and run `bun run --cwd packages/operations specs:stable:accept` only for an intentional contract release.",
		);
	}
	console.log(
		`Stable operation compatibility: ${current.operations.length} contracts match the accepted baseline.`,
	);
}
