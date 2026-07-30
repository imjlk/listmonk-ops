import { resolve } from "node:path";
import { emailOperationsSpec } from "../src/specs";
import { stableJson } from "./stable-json";

const baselinePath = resolve(
	import.meta.dir,
	"../generated/specs/stable-contract-baseline.json",
);
const accept = Bun.argv.includes("--accept");
const STABLE_CONTRACT_BASELINE_VERSION = 1;

const current = {
	baselineVersion: STABLE_CONTRACT_BASELINE_VERSION,
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
const expected = stableJson(current);

if (accept) {
	await Bun.write(baselinePath, expected);
	console.log(
		`Accepted ${current.operations.length} stable operation contracts.`,
	);
} else {
	const baselineFile = Bun.file(baselinePath);
	const baseline = (await baselineFile.exists())
		? await baselineFile.text()
		: undefined;
	if (baseline !== expected) {
		throw new Error(
			"Stable operation contracts changed. Review compatibility and run `bun run --cwd packages/operations specs:stable:accept` only for an intentional contract release.",
		);
	}
	console.log(
		`Stable operation compatibility: ${current.operations.length} contracts match the accepted baseline.`,
	);
}
