import type { tags } from "typia";
import type {
	NonNegativeInteger,
	PositiveInteger,
	SearchResultLimit,
	PrimeRecommendationLimit,
	NonEmptyString,
	CapabilityFamily,
} from "./primitives";

export type OperationSpecCoverage = "described" | "migration";

export interface OperationDiscoverySafety {
	read_only: boolean;
	destructive: boolean;
	idempotent: boolean;
	confirmation_required: boolean;
	audit_required: boolean;
	dry_run_supported: boolean;
}

export interface OperationSearchResult {
	family: NonEmptyString;
	id: NonEmptyString;
	mcp_name: NonEmptyString;
	title: NonEmptyString;
	description: NonEmptyString;
	score: NonNegativeInteger;
	coverage: OperationSpecCoverage;
	resource?: NonEmptyString | undefined;
	verb?: NonEmptyString | undefined;
	stability?: "experimental" | "stable" | "deprecated" | undefined;
	safety: OperationDiscoverySafety;
	use_when: string[];
	avoid_when: string[];
}

export interface SpecSearchInput {
	query: NonEmptyString;
	family?: NonEmptyString | undefined;
	resource?: NonEmptyString | undefined;
	verb?: NonEmptyString | undefined;
	limit?: SearchResultLimit | undefined;
}

export interface SpecSearchOutput {
	query: NonEmptyString;
	total: NonNegativeInteger;
	results: OperationSearchResult[];
}

export interface SpecDescribeInput {
	/** Shared operation ID or MCP tool name. */
	operation: NonEmptyString;
}

export interface OperationDescription extends Omit<
	OperationSearchResult,
	"score"
> {
	family_title: NonEmptyString;
	input_schema: Record<string, unknown>;
	output_schema: Record<string, unknown>;
	spec?: Record<string, unknown> | undefined;
	migration?: Record<string, unknown> | undefined;
}

export interface SpecDescribeOutput {
	operation: OperationDescription;
}

export interface EmptyInput {}

export interface PlaybookSummary {
	id: NonEmptyString;
	title: NonEmptyString;
	goal: NonEmptyString;
	step_count: PositiveInteger;
	recovery_operation: NonEmptyString;
}

export interface PlaybookListOutput {
	playbooks: PlaybookSummary[];
}

export interface PlaybookGetInput {
	id: NonEmptyString;
}

export interface PlaybookOperationReference {
	step_id: NonEmptyString;
	operation: OperationSearchResult;
	approval: "none" | "human";
}

export type PlaybookPrimitive = string | number | boolean | null;

export interface PlaybookInput {
	name: NonEmptyString;
	type: "string" | "number" | "boolean";
	required: boolean;
	description: NonEmptyString;
}

export type PlaybookValueSource =
	| {
			kind: "playbook-input";
			name: NonEmptyString;
	  }
	| {
			kind: "step-output";
			step_id: NonEmptyString;
			path: NonEmptyString;
	  }
	| {
			kind: "literal";
			value: PlaybookPrimitive;
	  };

export interface PlaybookInputBinding {
	parameter: NonEmptyString;
	source: PlaybookValueSource;
}

export interface PlaybookResultGuard {
	path: NonEmptyString;
	operator: "equals" | "not-equals";
	expected: PlaybookPrimitive;
	on_failure: "stop";
	message: NonEmptyString;
}

export interface PlaybookStep {
	id: NonEmptyString;
	operation: NonEmptyString;
	approval: "none" | "human";
	description: NonEmptyString;
	depends_on: NonEmptyString[];
	input: PlaybookInputBinding[];
	result_guard?: PlaybookResultGuard | undefined;
}

export interface PlaybookDetail {
	id: NonEmptyString;
	title: NonEmptyString;
	goal: NonEmptyString;
	inputs: PlaybookInput[];
	steps: PlaybookStep[] & tags.MinItems<1>;
	recovery_operation: NonEmptyString;
}

export interface PlaybookGetOutput {
	playbook: PlaybookDetail;
	operations: PlaybookOperationReference[];
}

export interface ControlCapabilitiesOutput {
	schema_version: NonEmptyString;
	resources: NonNegativeInteger;
	playbooks: NonNegativeInteger;
	operations: NonNegativeInteger;
	described_operations: NonNegativeInteger;
	migration_operations: NonNegativeInteger;
	spec_coverage_complete: boolean;
	families: CapabilityFamily[];
}

export interface ControlPrimeInput {
	goal?: NonEmptyString | undefined;
	limit?: PrimeRecommendationLimit | undefined;
}

export interface ControlPrimeOutput {
	goal?: NonEmptyString | undefined;
	capabilities: ControlCapabilitiesOutput;
	recommended_operations: OperationSearchResult[];
	recommended_playbooks: PlaybookSummary[];
	guidance: string[];
}

export interface ControlStatusInput {}

export interface ControlStatusOutput {
	surface: "cli" | "mcp";
	version: NonEmptyString;
	runtime: Record<string, string>;
	target?: {
		url: NonEmptyString;
		auth: "token" | "none";
	} | undefined;
	listmonk: {
		configured: boolean;
		reachable: boolean;
		health_error?: string | undefined;
	};
	specs: {
		schema_version: NonEmptyString;
		operations: NonNegativeInteger;
		described: NonNegativeInteger;
		migrations: NonNegativeInteger;
		complete: boolean;
	};
	readiness: {
		catalog: boolean;
		specs: boolean;
		listmonk: boolean;
	};
}
