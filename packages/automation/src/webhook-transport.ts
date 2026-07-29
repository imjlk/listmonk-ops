import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";

export type ResolvedWebhookAddress = Readonly<{
	address: string;
	family: 4 | 6;
}>;

type PinnedWebhookRequest = Readonly<{
	url: string;
	address: ResolvedWebhookAddress;
	headers: Readonly<Record<string, string>>;
	body: string;
	signal: AbortSignal;
}>;

type PinnedWebhookResponse = Readonly<{
	ok: boolean;
	status: number;
}>;

function postPinnedHttpsWebhook(
	input: PinnedWebhookRequest,
): Promise<PinnedWebhookResponse> {
	const parsed = new URL(input.url);
	const hostname = parsed.hostname.replace(/^\[|\]$/gu, "");
	const lookup: LookupFunction = (_hostname, _options, callback) => {
		callback(null, input.address.address, input.address.family);
	};
	return new Promise((resolve, reject) => {
		const request = httpsRequest(
			parsed,
			{
				method: "POST",
				headers: input.headers,
				lookup,
				family: input.address.family,
				servername: isIP(hostname) === 0 ? hostname : undefined,
				signal: input.signal,
			},
			(response) => {
				const status = response.statusCode ?? 0;
				response.destroy();
				resolve({ ok: status >= 200 && status < 300, status });
			},
		);
		request.once("error", reject);
		request.end(input.body);
	});
}

export async function postPinnedHttpsWebhookWithFallback(
	input: Readonly<{
		url: string;
		addresses: readonly ResolvedWebhookAddress[];
		headers: Readonly<Record<string, string>>;
		body: string;
		signal: AbortSignal;
	}>,
	send: (input: PinnedWebhookRequest) => Promise<PinnedWebhookResponse> =
		postPinnedHttpsWebhook,
): Promise<PinnedWebhookResponse> {
	const failures: unknown[] = [];
	for (const address of input.addresses) {
		try {
			return await send({
				url: input.url,
				address,
				headers: input.headers,
				body: input.body,
				signal: input.signal,
			});
		} catch (error) {
			failures.push(error);
			if (input.signal.aborted) {
				throw error;
			}
		}
	}
	throw new AggregateError(
		failures,
		`Unable to connect to any validated address for ${new URL(input.url).hostname}`,
	);
}
