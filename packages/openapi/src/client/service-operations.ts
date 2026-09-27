import {
	deleteBounceById,
	deleteBounces,
	deleteCampaignAnalyticsByType,
	deleteGcSubscribers,
	deleteUnconfirmedSubscriptions,
	getAboutInfo,
	getBounceById,
	getBounces,
	getDashboardCharts,
	getDashboardCounts,
	getImportSubscribers,
	getImportSubscriberLogs,
	getLogs,
	getServerConfig,
	getSettings,
	importSubscribers,
	reloadApp,
	stopImportSubscribers,
	testSmtpSettings,
	transactWithSubscriber,
	updateSettings,
} from "../../generated/sdk.gen";
import type * as t from "../../generated/types.gen";
import type {
	BounceListOptions,
	EnhancedListmonkClient,
	ImportStartParams,
	TransactionalSendParams,
} from "./contracts";
import type { SdkOptions } from "./crud";
import type { CrudResult, FlattenedResponse } from "./response";
import { normalizeListResult, transformResponse } from "./response";
import {
	isSettingsCredentialQueryParameter,
	SETTINGS_REDACTED_VALUE,
} from "./settings-redaction";

export function createImportOperations(
	sdkOptions: SdkOptions,
): EnhancedListmonkClient["import"] {
	return {
		async get() {
			const result = await getImportSubscribers(sdkOptions);
			return (await transformResponse(
				result,
			)) as FlattenedResponse<t.ImportStatus>;
		},
		async stop() {
			const result = await stopImportSubscribers(sdkOptions);
			return (await transformResponse(
				result,
			)) as FlattenedResponse<t.ImportStatus>;
		},
		async logs() {
			const result = await getImportSubscriberLogs(sdkOptions);
			return (await transformResponse(result)) as FlattenedResponse<string>;
		},
		async start(params: ImportStartParams) {
			const importParams = {
				mode: params.mode,
				delim: params.delim,
				lists: params.lists,
				overwrite: params.overwrite,
				...(params.subscription_status && {
					subscription_status: params.subscription_status,
				}),
			};
			const result = await importSubscribers({
				...sdkOptions,
				body: {
					params: JSON.stringify(importParams),
					file: params.file,
				},
			});
			return (await transformResponse(
				result,
			)) as FlattenedResponse<t.ImportStatus>;
		},
	};
}

export function createBounceOperations(
	sdkOptions: SdkOptions,
): EnhancedListmonkClient["bounce"] {
	return {
		async list(options?: BounceListOptions) {
			const mergedOptions = options
				? { ...sdkOptions, query: options }
				: sdkOptions;
			const result = await getBounces(mergedOptions);
			return normalizeListResult<t.Bounce>(await transformResponse(result));
		},
		async getById(options: { path: { id: number } }) {
			const result = await getBounceById({ ...sdkOptions, ...options });
			return (await transformResponse(result)) as CrudResult<t.Bounce>;
		},
		async delete(options: { query: { all?: boolean; id?: string } }) {
			const result = await deleteBounces({ ...sdkOptions, ...options });
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
		async deleteById(options: { path: { id: number } }) {
			const result = await deleteBounceById({ ...sdkOptions, ...options });
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
	};
}

export function createMaintenanceOperations(
	sdkOptions: SdkOptions,
): EnhancedListmonkClient["maintenance"] {
	return {
		async gcSubscribers(options: { path: { type: "orphan" | "blocklisted" } }) {
			const result = await deleteGcSubscribers({
				...sdkOptions,
				path: options.path,
			});
			return (await transformResponse(result)) as FlattenedResponse<{
				count?: number;
			}>;
		},
		async gcUnconfirmedSubscriptions(options: {
			query: { before_date: string };
		}) {
			const result = await deleteUnconfirmedSubscriptions({
				...sdkOptions,
				query: options.query,
			});
			return (await transformResponse(result)) as FlattenedResponse<{
				count?: number;
			}>;
		},
		async gcAnalytics(options: {
			path: { type: "all" | "views" | "clicks" };
			query: { before_date: string };
		}) {
			const result = await deleteCampaignAnalyticsByType({
				...sdkOptions,
				path: options.path,
				query: options.query,
			});
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
	};
}

export function createTransactionalOperations(
	sdkOptions: SdkOptions,
): EnhancedListmonkClient["transactional"] {
	return {
		async send(options: TransactionalSendParams) {
			const result = await transactWithSubscriber({
				...sdkOptions,
				body: options,
			});
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
	};
}

export function createSettingsOperations(
	sdkOptions: SdkOptions,
): EnhancedListmonkClient["settings"] {
	return {
		async get() {
			const result = await getSettings(sdkOptions);
			return (await transformResponse(result)) as FlattenedResponse<t.Settings>;
		},
		async update(options: { body: Record<string, unknown> }) {
			assertNoRedactedSettingsPlaceholder(options.body, "update");
			const result = await updateSettings({ ...sdkOptions, ...options });
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
		async testSmtp(options: { body: Record<string, unknown> }) {
			assertNoRedactedSettingsPlaceholder(options.body, "test SMTP");
			const result = await testSmtpSettings({ ...sdkOptions, ...options });
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
	};
}

/** Reject redacted display values before an operation can send them to Listmonk. */
function assertNoRedactedSettingsPlaceholder(
	value: unknown,
	action: "update" | "test SMTP",
): void {
	if (!containsRedactedSettingsPlaceholder(value)) return;
	throw new TypeError(
		`Cannot ${action} settings with "${SETTINGS_REDACTED_VALUE}" placeholders; replace them with the actual values first.`,
	);
}

/** Walk nested settings data for exact or URL/query-shaped redaction markers. */
function containsRedactedSettingsPlaceholder(
	value: unknown,
	seen = new WeakSet<object>(),
): boolean {
	if (typeof value === "string") {
		return containsRedactedSettingsPlaceholderInString(value);
	}
	if (value === null || typeof value !== "object") return false;
	if (seen.has(value)) return false;
	seen.add(value);
	const entries = Array.isArray(value) ? value : Object.values(value);
	return entries.some((entry) =>
		containsRedactedSettingsPlaceholder(entry, seen),
	);
}

/** Ignore prose mentions while detecting markers emitted as credential values. */
function containsRedactedSettingsPlaceholderInString(
	value: string,
	decodeDepth = 0,
): boolean {
	let index = value.indexOf(SETTINGS_REDACTED_VALUE);
	while (index !== -1) {
		const prefix = value.slice(0, index);
		const markerEnd = index + SETTINGS_REDACTED_VALUE.length;
		const suffix = value.slice(markerEnd);
		if (value === SETTINGS_REDACTED_VALUE) return true;
		if (
			suffix.startsWith("@") &&
			/[a-z][a-z0-9+.-]*:[\\/]{2}[^/?#\\]*$/i.test(prefix)
		) {
			return true;
		}
		if (isCredentialQueryValueMarker(value, index)) return true;
		index = value.indexOf(SETTINGS_REDACTED_VALUE, markerEnd);
	}

	const lowerCaseValue = value.toLowerCase();
	const encodedMarker = "%5bredacted%5d";
	let encodedIndex = lowerCaseValue.indexOf(encodedMarker);
	while (encodedIndex !== -1) {
		const prefix = value.slice(0, encodedIndex);
		const suffix = lowerCaseValue.slice(encodedIndex + encodedMarker.length);
		if (
			(suffix.startsWith("%40") &&
				/(?:%3a|:)(?:%2f|\x2f){2}$/i.test(prefix)) ||
			isCredentialQueryValueMarker(value, encodedIndex)
		) {
			return true;
		}
		encodedIndex = lowerCaseValue.indexOf(
			encodedMarker,
			encodedIndex + encodedMarker.length,
		);
	}

	if (decodeDepth < 3 && value.includes("%")) {
		try {
			const decoded = decodeURIComponent(value.replace(/\+/g, " "));
			if (
				decoded !== value &&
				containsRedactedSettingsPlaceholderInString(decoded, decodeDepth + 1)
			) {
				return true;
			}
		} catch {
			// Direct marker checks still work when unrelated escapes are malformed.
		}
	}
	return false;
}

function isCredentialQueryValueMarker(value: string, markerIndex: number): boolean {
	const prefix = value.slice(0, markerIndex);
	const assignmentPattern = /(?:=|%3d)/gi;
	let assignment: RegExpExecArray | null;
	let lastAssignment: RegExpExecArray | undefined;
	while ((assignment = assignmentPattern.exec(prefix)) !== null) {
		lastAssignment = assignment;
	}
	if (lastAssignment === undefined || lastAssignment.index === undefined) {
		return false;
	}

	const separatorPattern = /(?:[?&#;]|%3f|%26|%23|%3b)/gi;
	let separator: RegExpExecArray | null;
	let lastSeparator: RegExpExecArray | undefined;
	while ((separator = separatorPattern.exec(prefix)) !== null) {
		if (separator.index >= lastAssignment.index) break;
		lastSeparator = separator;
	}
	const nameStart = lastSeparator?.index === undefined
		? 0
		: lastSeparator.index + lastSeparator[0].length;
	return isSettingsCredentialQueryParameter(
		prefix.slice(nameStart, lastAssignment.index),
	);
}

export function createDashboardOperations(
	sdkOptions: SdkOptions,
): EnhancedListmonkClient["dashboard"] {
	return {
		async getCharts(options?: { query?: { type?: string } }) {
			const mergedOptions = options ? { ...sdkOptions, ...options } : sdkOptions;
			const result = await getDashboardCharts(mergedOptions);
			return (await transformResponse(
				result,
			)) as FlattenedResponse<t.DashboardChart>;
		},
		async getCounts() {
			const result = await getDashboardCounts(sdkOptions);
			return (await transformResponse(
				result,
			)) as FlattenedResponse<t.DashboardCount>;
		},
	};
}

export function createSystemOperations(
	sdkOptions: SdkOptions,
): EnhancedListmonkClient["system"] {
	return {
		async getAbout() {
			const result = await getAboutInfo(sdkOptions);
			return (await transformResponse(result)) as FlattenedResponse<t.About>;
		},
		async getConfig() {
			const result = await getServerConfig(sdkOptions);
			return (await transformResponse(
				result,
			)) as FlattenedResponse<t.ServerConfig>;
		},
		async getLogs() {
			const result = await getLogs(sdkOptions);
			return (await transformResponse(result)) as FlattenedResponse<string[]>;
		},
		async reload() {
			const result = await reloadApp(sdkOptions);
			return (await transformResponse(result)) as FlattenedResponse<boolean>;
		},
	};
}
