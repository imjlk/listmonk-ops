import {
	getCampaigns as getGeneratedCampaigns,
	type Options,
} from "../../generated/sdk.gen";
import type { GetCampaignsData as GeneratedGetCampaignsData } from "../../generated/types.gen";

export type GetCampaignsData = Omit<GeneratedGetCampaignsData, "query"> & {
	query?: NonNullable<GeneratedGetCampaignsData["query"]> & {
		/** @deprecated Use tag. Explicit tag takes precedence over this alias. */
		tags?: string[];
	};
};

/** Preserve the public tags alias while Listmonk 6.2 receives repeated tag parameters. */
export function getCampaigns<ThrowOnError extends boolean = false>(
	options?: Options<GetCampaignsData, ThrowOnError>,
) {
	const { tags, ...query } = options?.query ?? {};
	return getGeneratedCampaigns<ThrowOnError>({
		...options,
		query: { ...query, tag: query.tag ?? tags },
	});
}
