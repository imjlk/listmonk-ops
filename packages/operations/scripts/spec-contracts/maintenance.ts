import type { tags } from "typia";
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
	count: number;
}

export type MaintenanceGcUnconfirmedInput = {
	/** RFC3339 cutoff; subscriptions unconfirmed before this date are deleted. */
	before_date: MaintenanceBeforeDate;
};

export interface MaintenanceGcUnconfirmedOutput {
	before_date: string;
	/** Unconfirmed subscriptions deleted by this request. */
	count: number;
}
