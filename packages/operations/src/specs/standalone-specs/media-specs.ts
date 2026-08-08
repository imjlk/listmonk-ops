import { defineOperationSpec } from "../operation";
{}
import {
	mediaDeleteInputContract,
	mediaDeleteOutputContract,
	mediaUploadInputContract,
	mediaRecordContract,
} from "../contract-schemas";

export const mediaDeleteOperationSpec = defineOperationSpec({
	id: "media.delete",
	resource: "media",
	verb: "delete",
	title: "Delete media file",
	description: "Delete an uploaded media file from Listmonk",
	contract: {
		input: mediaDeleteInputContract,
		output: mediaDeleteOutputContract,
	},
	effects: [{ kind: "delete", resource: "media", reversible: false }],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "reconcile",
		reconcileWith: "media.list",
		idempotent: true,
		reason:
			"Deleting an already-deleted media file is a no-op; verify with media.list after an ambiguous result.",
	},
	agent: {
		useWhen: ["A media file must be permanently removed."],
		avoidWhen: ["The media file is referenced by a campaign or template."],
		prerequisites: ["media.get"],
		verifyWith: ["media.list"],
		related: ["media.get", "media.upload"],
		retryGuidance: "Verify the file is gone with media.list before retrying.",
	},
	projection: {
		mcpName: "listmonk_delete_media",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/media-specs.ts#mediaDeleteOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/media-specs.ts#bindMediaDeleteOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/media.ts#deleteMediaOperation:variable",
			invokerNode:
				"packages/operations/src/media.ts#invokeDeleteMediaOperation:function",
			executorNode:
				"packages/operations/src/media.ts#deleteMediaFile:function",
		},
	},
	stability: "experimental",
	since: "0.9.0",
});

export const mediaUploadOperationSpec = defineOperationSpec({
	id: "media.upload",
	resource: "media",
	verb: "upload",
	title: "Upload media file",
	description:
		"Upload a media file to Listmonk from base64-encoded contents. Validates an allowlist of MIME types and a 10 MiB size cap before sending.",
	contract: {
		input: mediaUploadInputContract,
		output: mediaRecordContract,
	},
	effects: [{ kind: "write", resource: "media", reversible: true }],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: {
		kind: "unsafe",
		reason:
			"A retry may upload another file unless the original media ID is known.",
	},
	agent: {
		useWhen: ["A new media file must be uploaded."],
		avoidWhen: ["An existing media file should be referenced instead."],
		prerequisites: [],
		verifyWith: ["media.list"],
		related: ["media.delete"],
		retryGuidance: "Inspect media.list before retrying an ambiguous upload.",
	},
	projection: {
		mcpName: "listmonk_upload_media",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/media-specs.ts#mediaUploadOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/media-specs.ts#bindMediaUploadOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/media.ts#uploadMediaOperation:variable",
			invokerNode:
				"packages/operations/src/media.ts#invokeUploadMediaOperation:function",
			executorNode:
				"packages/operations/src/media.ts#uploadMediaFile:function",
		},
	},
	stability: "experimental",
	since: "0.9.0",
});

export function bindMediaDeleteOperationSpec(): typeof mediaDeleteOperationSpec {
	return mediaDeleteOperationSpec;
}

export function bindMediaUploadOperationSpec(): typeof mediaUploadOperationSpec {
	return mediaUploadOperationSpec;
}
