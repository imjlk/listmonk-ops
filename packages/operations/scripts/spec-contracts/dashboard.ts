/** Subscriber aggregate counters from the dashboard totals. */
export interface DashboardSubscriberCounts {
	total?: number | undefined;
	/** Observed as null when Listmonk has not computed the breakdown. */
	blocklisted?: number | null | undefined;
	orphans?: number | undefined;
	/** Preserve fields added by newer Listmonk releases. */
	[key: string]: unknown;
}

/** List aggregate counters from the dashboard totals. */
export interface DashboardListCounts {
	total?: number | undefined;
	private?: number | undefined;
	public?: number | undefined;
	optin_single?: number | undefined;
	optin_double?: number | undefined;
	/** Preserve fields added by newer Listmonk releases. */
	[key: string]: unknown;
}

/** Campaign aggregate counters from the dashboard totals. */
export interface DashboardCampaignCounts {
	total?: number | undefined;
	/** Campaign counts keyed by status label (e.g. draft, finished). */
	by_status?: Record<string, number> | undefined;
	/** Preserve fields added by newer Listmonk releases. */
	[key: string]: unknown;
}

export interface DashboardCountsOutput {
	subscribers?: DashboardSubscriberCounts | undefined;
	lists?: DashboardListCounts | undefined;
	campaigns?: DashboardCampaignCounts | undefined;
	/** Transactional message count observed as a bare number. */
	messages?: number | undefined;
	/** Preserve fields added by newer Listmonk releases. */
	[key: string]: unknown;
}

/** One daily bucket of a dashboard chart series. */
export interface DashboardChartPoint {
	count?: number | undefined;
	date?: string | undefined;
	/** Preserve fields added by newer Listmonk releases. */
	[key: string]: unknown;
}

export interface DashboardChartsOutput {
	link_clicks?: DashboardChartPoint[] | undefined;
	campaign_views?: DashboardChartPoint[] | undefined;
	/** Preserve fields added by newer Listmonk releases. */
	[key: string]: unknown;
}
