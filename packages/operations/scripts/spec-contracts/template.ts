import type { tags } from "typia";
import type {
	ResourceId,
	NonNegativeInteger,
	PositiveInteger,
	NonEmptyString,
	TrimmedNonEmptyString,
	ResourceIdInput,
} from "./primitives";

export interface TemplateRecord {
	id?: ResourceId | undefined;
	created_at?: string | undefined;
	updated_at?: string | undefined;
	name?: string | undefined;
	body?: string | undefined;
	body_source?: string | null | undefined;
	subject?: string | undefined;
	type?: string | undefined;
	is_default?: boolean | undefined;
	/** Preserve fields added by newer Listmonk releases. */
	[key: string]: unknown;
}

export type TemplateType = "campaign" | "campaign_visual" | "tx";

export interface TemplateCreateInput {
	name: NonEmptyString;
	/** Caller-scoped create key; an identical retry with the same key replays the originally created template. */
	idempotency_key?: NonEmptyString & tags.MaxLength<200>;
	/** Omitted values default to `"campaign"` at the runtime boundary. */
	type?: TemplateType | undefined;
	/** Omitted values default to an empty subject at the runtime boundary. */
	subject?: string | undefined;
	body_source?: string | undefined;
	body: NonEmptyString;
}

export interface TemplateCreateOutput {
	template: TemplateRecord;
	created: boolean;
}

export interface TemplateUpdateFields {
	name?: NonEmptyString | undefined;
	type?: TemplateType | undefined;
	subject?: string | undefined;
	body_source?: string | undefined;
	body?: NonEmptyString | undefined;
}

export type TemplateUpdateInput = ResourceIdInput &
	(
		| (TemplateUpdateFields & { name: NonEmptyString })
		| (TemplateUpdateFields & { type: TemplateType })
		| (TemplateUpdateFields & { subject: string })
		| (TemplateUpdateFields & { body_source: string })
		| (TemplateUpdateFields & { body: NonEmptyString })
	);

export interface TemplateDeleteOutput {
	id: ResourceId;
	deleted: boolean;
}

export interface TemplateSetDefaultOutput {
	id: ResourceId;
	set_default: true;
}

export interface TemplateListInput {
	/** One-based result page. Omitted values use the shared operation default. */
	page?: PositiveInteger | undefined;
	/** Number of records per page. Omitted values use the shared operation default. */
	per_page?: PositiveInteger | undefined;
	/** Omit template bodies from collection responses. */
	no_body?: boolean | undefined;
}

export interface TemplateCollectionOutput {
	results: TemplateRecord[];
	total: number;
	per_page: number;
	page: number;
}

export type TemplateManifestType = TemplateType;

export interface TemplateManifestEntry {
	name: NonEmptyString & tags.MaxLength<120>;
	/**
	 * Template type. Optional on input and defaults to `"campaign"`, matching
	 * the runtime Zod schema's `.default("campaign")`.
	 */
	type?: TemplateManifestType;
	/**
	 * Email subject. Optional on input and defaults to `""`, matching the
	 * runtime Zod schema's `.optional().default("")`. Reconciliation of an
	 * existing template with an omitted subject clears it rather than preserving
	 * the prior value.
	 */
	subject?: string;
	body_source?: string;
	body: NonEmptyString & tags.MaxLength<1048576>;
}

export interface TemplateManifestReconcileInput {
	schema_version: 1;
	templates: TemplateManifestEntry[] &
		tags.MinItems<1> &
		tags.MaxItems<500>;
	/**
	 * Plan only when true; apply when false. Optional on input and defaults to
	 * a safe dry run (true), matching the runtime Zod schema's `.default(true)`.
	 */
	dry_run?: boolean;
}

export type TemplateReconcileAction = "create" | "update" | "unchanged";

export interface TemplateReconcileSummary {
	name: NonEmptyString & tags.MaxLength<120>;
	action: TemplateReconcileAction;
	applied: boolean;
}

export interface TemplateManifestReconcileOutput {
	schema_version: 1;
	dry_run: boolean;
	results: TemplateReconcileSummary[];
}

export interface TemplateRegistrySyncInput {
	template_id?: ResourceId;
	template_ids?: ResourceId[];
	note?: string;
}

export interface TemplateRegistrySyncOutput {
	capturedAt: string;
	createdVersions: NonNegativeInteger;
	unchangedTemplates: NonNegativeInteger;
	errors: string[];
	templates: Array<{
		templateId: ResourceId;
		templateName: string;
		versionId?: string;
		changed: boolean;
		hash: string;
	}>;
}

export interface TemplateRegistryVersion {
	versionId: string;
	capturedAt: string;
	hash: string;
	note?: string;
	snapshot: {
		id: ResourceId;
		name: string;
		type: string;
		subject: string;
		body: string;
		bodySource?: string;
	};
}

export interface TemplateRegistryHistoryOutput {
	templateId: ResourceId;
	templateName: string;
	activeVersionId?: string;
	/** Monotonic count of registry-managed template writes (a same-version re-promotion included); echo it to pin a rollback retry. */
	headRevision: NonNegativeInteger;
	versions: TemplateRegistryVersion[];
}

export interface TemplateIdInput {
	template_id: ResourceId;
}

export interface TemplatePromoteInput extends TemplateIdInput {
	version_id: NonEmptyString;
	expected_remote_hash?: string;
	/** Override hash mismatch check. Defaults to false. */
	force?: boolean;
}

export interface TemplatePromoteOutput {
	templateId: ResourceId;
	templateName: string;
	versionId: string;
	activeVersionId: string;
	/** Registry head revision after this promotion; echo it to pin a later rollback retry. */
	headRevision: NonNegativeInteger;
	promotedAt: string;
	/** False when the target version already matched the remote template (a no-op that issues no write). */
	promoted: boolean;
}
