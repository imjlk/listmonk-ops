import { bridgedOperationSpecsById } from "./bridged";
import {
	campaignGetOperationSpec,
	campaignScheduleOperationSpec,
} from "./pilot";
import { campaignPreflightOperationSpec } from "./high-risk";
import { defineOperationPlaybook } from "./playbook";

export const campaignSafeSchedulePlaybook = defineOperationPlaybook({
	id: "campaign.safe-schedule",
	title: "Safely schedule a campaign",
	goal:
		"Inspect and preflight a reviewed campaign, obtain human approval, schedule delivery, and verify the resulting state.",
	inputs: [
		{
			name: "campaign_id",
			type: "number",
			required: true,
			description: "Listmonk campaign ID to schedule",
		},
		{
			name: "send_at",
			type: "string",
			required: true,
			description: "Future delivery timestamp",
		},
	],
	steps: [
		{
			id: "inspect",
			operation: campaignGetOperationSpec.id,
			approval: "none",
			description: "Inspect the campaign and its current status.",
			dependsOn: [],
			input: [
				{
					parameter: "id",
					source: { kind: "playbook-input", name: "campaign_id" },
				},
			],
		},
		{
			id: "preflight",
			operation: campaignPreflightOperationSpec.id,
			approval: "none",
			description: "Run pre-send checks against the final campaign.",
			dependsOn: ["inspect"],
			input: [
				{
					parameter: "campaign_id",
					source: { kind: "playbook-input", name: "campaign_id" },
				},
				{
					parameter: "max_audience",
					source: { kind: "literal", value: 200_000 },
				},
				{
					parameter: "check_links",
					source: { kind: "literal", value: true },
				},
				{
					parameter: "link_check_timeout_ms",
					source: { kind: "literal", value: 4_000 },
				},
			],
			resultGuard: {
				path: "summary.fail",
				operator: "equals",
				expected: 0,
				onFailure: "stop",
				message: "Do not schedule while any preflight check fails.",
			},
		},
		{
			id: "schedule",
			operation: campaignScheduleOperationSpec.id,
			approval: "human",
			description: "Schedule bulk delivery after explicit human confirmation.",
			dependsOn: ["preflight"],
			input: [
				{
					parameter: "id",
					source: { kind: "playbook-input", name: "campaign_id" },
				},
				{
					parameter: "send_at",
					source: { kind: "playbook-input", name: "send_at" },
				},
				{
					parameter: "expected_updated_at",
					source: {
						kind: "step-output",
						stepId: "preflight",
						path: "campaignUpdatedAt",
					},
				},
			],
		},
		{
			id: "verify",
			operation: campaignGetOperationSpec.id,
			approval: "none",
			description: "Verify the campaign entered the scheduled state.",
			dependsOn: ["schedule"],
			input: [
				{
					parameter: "id",
					source: {
						kind: "step-output",
						stepId: "schedule",
						path: "id",
					},
				},
			],
			resultGuard: {
				path: "status",
				operator: "equals",
				expected: "scheduled",
				onFailure: "stop",
				message: "Stop and reconcile if scheduling cannot be verified.",
			},
		},
	],
	recoveryOperation: campaignGetOperationSpec.id,
});

export const templateSafePromotePlaybook = defineOperationPlaybook({
	id: "template.safe-promote",
	title: "Safely promote a template version",
	goal:
		"Inspect remote and stored template state, obtain human approval, promote an expected version, and verify the result.",
	inputs: [
		{
			name: "template_id",
			type: "number",
			required: true,
			description: "Listmonk template ID",
		},
		{
			name: "version_id",
			type: "string",
			required: true,
			description: "Stored registry version ID to promote",
		},
		{
			name: "expected_remote_hash",
			type: "string",
			required: true,
			description:
				"Hash of the remote template content observed before promotion",
		},
	],
	steps: [
		{
			id: "inspect-remote",
			operation: bridgedOperationSpecsById["templates.get"].id,
			approval: "none",
			description: "Inspect current Listmonk template content.",
			dependsOn: [],
			input: [
				{
					parameter: "id",
					source: { kind: "playbook-input", name: "template_id" },
				},
			],
		},
		{
			id: "inspect-history",
			operation:
				bridgedOperationSpecsById["ops.templates.registry-history"].id,
			approval: "none",
			description: "Inspect stored template versions.",
			dependsOn: ["inspect-remote"],
			input: [
				{
					parameter: "template_id",
					source: { kind: "playbook-input", name: "template_id" },
				},
			],
		},
		{
			id: "promote",
			operation:
				bridgedOperationSpecsById["ops.templates.registry-promote"].id,
			approval: "human",
			description: "Promote the selected version after explicit approval.",
			dependsOn: ["inspect-history"],
			input: [
				{
					parameter: "template_id",
					source: { kind: "playbook-input", name: "template_id" },
				},
				{
					parameter: "version_id",
					source: { kind: "playbook-input", name: "version_id" },
				},
				{
					parameter: "expected_remote_hash",
					source: {
						kind: "playbook-input",
						name: "expected_remote_hash",
					},
				},
			],
		},
		{
			id: "verify",
			operation: bridgedOperationSpecsById["templates.get"].id,
			approval: "none",
			description: "Re-read the remote template after promotion.",
			dependsOn: ["promote"],
			input: [
				{
					parameter: "id",
					source: { kind: "playbook-input", name: "template_id" },
				},
			],
		},
	],
	recoveryOperation: bridgedOperationSpecsById["templates.get"].id,
});

export const abTestSafeRunPlaybook = defineOperationPlaybook({
	id: "abtest.safe-run",
	title: "Safely advance one A/B test",
	goal:
		"Inspect an experiment, obtain human approval for its next lifecycle action, execute one step, and re-read persisted state.",
	inputs: [
		{
			name: "test_id",
			type: "string",
			required: true,
			description: "Persisted A/B test ID",
		},
	],
	steps: [
		{
			id: "inspect",
			operation: bridgedOperationSpecsById["abtest.get"].id,
			approval: "none",
			description: "Inspect current experiment status and gates.",
			dependsOn: [],
			input: [
				{
					parameter: "test_id",
					source: { kind: "playbook-input", name: "test_id" },
				},
			],
		},
		{
			id: "run",
			operation: bridgedOperationSpecsById["abtest.run"].id,
			approval: "human",
			description:
				"Advance exactly one lifecycle step after explicit approval.",
			dependsOn: ["inspect"],
			input: [
				{
					parameter: "test_id",
					source: { kind: "playbook-input", name: "test_id" },
				},
				{
					parameter: "expected_status",
					source: {
						kind: "step-output",
						stepId: "inspect",
						path: "test.status",
					},
				},
				{
					parameter: "expected_updated_at",
					source: {
						kind: "step-output",
						stepId: "inspect",
						path: "test.updatedAt",
					},
				},
				{
					parameter: "confirm",
					source: { kind: "literal", value: true },
				},
			],
		},
		{
			id: "verify",
			operation: bridgedOperationSpecsById["abtest.get"].id,
			approval: "none",
			description: "Read persisted experiment state after the action.",
			dependsOn: ["run"],
			input: [
				{
					parameter: "test_id",
					source: { kind: "playbook-input", name: "test_id" },
				},
			],
		},
	],
	recoveryOperation: bridgedOperationSpecsById["abtest.get"].id,
});
