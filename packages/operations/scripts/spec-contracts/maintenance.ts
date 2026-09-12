import type { tags } from "typia";
import type { NonNegativeInteger } from "./primitives";
import type { MAINTENANCE_BEFORE_DATE_PATTERN_SOURCE } from "../../src/maintenance-before-date";
/** RFC3339 cutoff bound shared with the executable schema. */
export type MaintenanceBeforeDate = string &
	tags.Pattern<typeof MAINTENANCE_BEFORE_DATE_PATTERN_SOURCE>;

export type MaintenanceGcType = "orphan" | "blocklisted";

export type MaintenanceGcSubscribersInput = {
	/** Which subscriber set the one-shot collection deletes. */
	type: MaintenanceGcType;
};

export interface MaintenanceGcSubscribersOutput {
	type: MaintenanceGcType;
	/** Subscribers deleted by this request (0 when the set was already empty). */
	count: NonNegativeInteger;
}

export type MaintenanceGcUnconfirmedInput = {
	/** RFC3339 cutoff; subscriptions unconfirmed before this date are deleted. */
	before_date: MaintenanceBeforeDate;
};

export interface MaintenanceGcUnconfirmedOutput {
	/** Echoed cutoff. */
	before_date: string;
	/** Unconfirmed subscriptions deleted by this request. */
	count: NonNegativeInteger;
}

export type MaintenanceAnalyticsType = "all" | "views" | "clicks";

export type MaintenanceGcAnalyticsInput = {
	/** Analytics category the one-shot collection deletes. */
	type: MaintenanceAnalyticsType;
	/** RFC3339 cutoff; analytics recorded before this date are deleted. */
	before_date: MaintenanceBeforeDate;
};

export interface MaintenanceGcAnalyticsOutput {
	type: MaintenanceAnalyticsType;
	/** Echoed cutoff. */
	before_date: string;
	/** Whether Listmonk acknowledged the deletion request. */
	deleted: boolean;
}
