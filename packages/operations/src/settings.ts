import type { ListmonkClient } from "@listmonk-ops/openapi";
import { bindSettingsGetOperationSpec } from "./specs";
import { z } from "zod";
import { defineOperationCatalog } from "./catalog";
import {
	defineOperation,
	normalizeOperationExecutionError,
	parseOperationInput,
	parseOperationOutput,
} from "./operation";
import {
	jsonResourceValue,
	readResourceSafety,
	unwrapResourceResponse,
} from "./resource-helpers";

export interface SettingsOperationContext {
	client: Pick<ListmonkClient, "settings">;
}

const settingsGetOutputSchema = z.object({
	settings: z.record(z.string(), z.unknown()),
});

export type SettingsDocument = z.output<typeof settingsGetOutputSchema>;

/** Marker substituted for every credential-bearing field. */
export const SETTINGS_REDACTED_VALUE = "[redacted]";

/**
 * Field names whose values are credentials. Matched exactly
 * (case-insensitive) and as substrings, so namespaced settings keys
 * like "bounce.sendgrid_key" or "upload.s3.aws_secret_access_key"
 * redact without enumerating every prefix. OAuth client ids and other
 * non-secret identifiers stay visible because operators need them to
 * correlate configurations.
 */
const CREDENTIAL_FIELD_NAMES = new Set([
	"key",
	"api_key",
	"apikey",
	"token",
	"access_key",
	"aws_access_key_id",
	"aws_secret_access_key",
	"sendgrid_key",
	"private_key",
	"password",
	"client_secret",
	"secret",
]);

const CREDENTIAL_SUBSTRINGS = [
	"password",
	"secret",
	"api_key",
	"access_key",
	"sendgrid_key",
	"forwardemail_key",
	"private_key",
	"token",
	// Postmark's server token is used as a webhook basic-auth credential
	// even though its field is only username-shaped.
	"postmark_username",
] as const;

function isCredentialFieldName(name: string): boolean {
	const lowered = name.toLowerCase();
	if (CREDENTIAL_FIELD_NAMES.has(lowered)) return true;
	return CREDENTIAL_SUBSTRINGS.some((needle) => lowered.includes(needle));
}

/**
 * Recursively replace credential-bearing fields. Arrays are walked so the
 * SMTP pool's per-entry passwords and any messenger credentials are
 * covered; non-object scalars pass through untouched.
 */
export function redactSettingsCredentials(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(redactSettingsCredentials);
	}
	if (value !== null && typeof value === "object") {
		const source = value as Record<string, unknown>;
		const result: Record<string, unknown> = Object.create(null);
		for (const [key, entry] of Object.entries(source)) {
			// Assign through defineProperty so a hostile "__proto__" key
			// cannot poison the result object's prototype.
			Object.defineProperty(result, key, {
				value: isCredentialFieldName(key)
					? SETTINGS_REDACTED_VALUE
					: redactSettingsCredentials(entry),
				enumerable: true,
				writable: true,
				configurable: true,
			});
		}
		return result;
	}
	return value;
}

/**
 * Read the installation settings with every credential-bearing field
 * redacted before the document leaves the executor. No shared surface
 * can persist or leak the raw SMTP/S3/OIDC credentials.
 */
export async function readSettings({
	client,
}: SettingsOperationContext): Promise<SettingsDocument> {
	const response = await client.settings.get();
	const document = unwrapResourceResponse(
		response,
		"Failed to read installation settings",
	);
	return {
		settings: redactSettingsCredentials(document) as Record<
			string,
			unknown
		>,
	};
}

export const getSettingsOperation = defineOperation({
	id: "settings.get",
	title: "Read installation settings (redacted)",
	description:
		"Read the Listmonk installation settings with every credential-bearing field (passwords, secrets, API keys, tokens) recursively replaced by [redacted].",
	inputSchema: z.object({}),
	outputSchema: settingsGetOutputSchema,
	safety: readResourceSafety,
	mcp: {
		name: "listmonk_get_settings",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindSettingsGetOperationSpec(),
	execute: readSettings,
});

export async function invokeGetSettingsOperation(
	context: SettingsOperationContext,
	input: unknown,
): Promise<SettingsDocument> {
	parseOperationInput(getSettingsOperation.inputSchema, input);
	let output: SettingsDocument;
	try {
		output = await readSettings(context);
	} catch (error) {
		throw normalizeOperationExecutionError(getSettingsOperation.id, error);
	}
	return parseOperationOutput(
		getSettingsOperation.id,
		getSettingsOperation.outputSchema,
		output,
	);
}

export const settingsOperations = [getSettingsOperation] as const;

export const settingsOperationCatalog = defineOperationCatalog({
	id: "settings",
	title: "Settings",
	operations: settingsOperations,
	specMigrationExemptions: [],
});

export type SettingsOperation = (typeof settingsOperations)[number];

const settingsOperationsByMcpName = new Map<string, SettingsOperation>(
	settingsOperations.map((operation) => [operation.mcp.name, operation]),
);

export function getSettingsOperationByMcpName(
	name: string,
): SettingsOperation | undefined {
	return settingsOperationsByMcpName.get(name);
}

export interface SettingsOperationInvocation {
	operation: SettingsOperation;
	output: Record<string, unknown>;
}

export async function invokeSettingsOperationByMcpName(
	context: SettingsOperationContext,
	name: string,
	input: unknown,
): Promise<SettingsOperationInvocation | undefined> {
	switch (name) {
		case getSettingsOperation.mcp.name:
			return {
				operation: getSettingsOperation,
				output: await invokeGetSettingsOperation(context, input),
			};
		default:
			return undefined;
	}
}
