import { defineOperationSpec } from "../operation";
import {
	mediaDeleteInputContract,
	mediaDeleteOutputContract,
	mediaUploadInputContract,
	mediaUploadOutputContract,
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
	stability: "stable",
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
		output: mediaUploadOutputContract,
	},
	effects: [{ kind: "write", resource: "media", reversible: true }],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: {
		kind: "conditional",
		cases: [
			{
				when: "idempotency_key is present",
				semantics: {
					kind: "safe",
					reason:
						"The key is atomically claimed in a durable store before the upload is issued and then bound to the uploaded media id; an identical retry (same key, same filename, effective MIME type, and normalized base64 content, same Listmonk target) replays that media file with created: false, a concurrent same-key upload waits for the in-flight one instead of issuing a second POST, and a different request or target under the same key is rejected. An attempt that ends ambiguously — or whose accepted response carries neither an id nor an immutable uuid to correlate — marks its claim unknown, and later same-key uploads fail fast with reconciliation guidance: the key is intentionally not reused, because no filename-based check can prove which same-named file an upload produced.",
				},
			},
			{
				when: "idempotency_key is absent",
				semantics: {
					kind: "unsafe",
					reason:
						"Listmonk media filenames are not unique, so a retry after an ambiguous upload provisions a duplicate file.",
				},
			},
		],
		reason:
			"Retry safety depends on whether the caller supplies an idempotency key.",
	},
	agent: {
		useWhen: ["A new media file must be uploaded."],
		avoidWhen: ["An existing media file should be referenced instead."],
		prerequisites: [],
		verifyWith: ["media.list"],
		related: ["media.delete"],
		retryGuidance:
			"Key the upload with idempotency_key so an ambiguous retry replays the bound media file; without a key, verify with media.list before repeating.",
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
	stability: "stable",
	since: "0.9.0",
});

export function bindMediaDeleteOperationSpec(): typeof mediaDeleteOperationSpec {
	return mediaDeleteOperationSpec;
}

export function bindMediaUploadOperationSpec(): typeof mediaUploadOperationSpec {
	return mediaUploadOperationSpec;
}
