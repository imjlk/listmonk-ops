import { parse, type DefaultTreeAdapterMap } from "parse5";

type HtmlNode = DefaultTreeAdapterMap["node"];
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const SUBSCRIPTION_PATH = new RegExp(`/subscription/${UUID}/${UUID}/?$`);
const INERT_ELEMENTS = new Set(["script", "style", "template", "noscript"]);
export const MAX_RENDERED_CAMPAIGN_CHARACTERS = 2_000_000;

function absoluteWebUrl(value: string): URL | undefined {
	try {
		const url = new URL(value.trim());
		if (!["https:", "http:"].includes(url.protocol) || url.username || url.password
   || value.includes("{{") || value.includes("}}")) return undefined;
		return url;
	} catch {
		return undefined;
	}
}

/** Native Listmonk routes and credential-bearing links are inspected, never visited. */
export function isCampaignControlLink(url: URL): boolean {
	let path: string;
	try {
		path = decodeURIComponent(url.pathname).toLowerCase();
	} catch {
		return true;
	}
	if (/(?:^|\/)(?:subscription|link|unsubscribe|optin|login|auth|oauth|reset|verify|confirm)(?:\/|$)/u.test(path)) return true;
	if (/\/campaign\/[^/]+\/[^/]+\/px\.png$/u.test(path)) return true;
	return [...url.searchParams.keys()].some((key) =>
		/^(?:token|code|signature|sig|access_token|auth)$/iu.test(key),
	);
}

function renderedAnchorUrls(html: string): string[] {
	const pending: HtmlNode[] = [parse(html)];
	const urls: string[] = [];
	while (pending.length > 0) {
		const node = pending.pop()!;
		if ("tagName" in node) {
			const attributes = new Map(
				node.attrs.map((attribute) => [attribute.name, attribute.value]),
			);
			if (INERT_ELEMENTS.has(node.tagName) || attributes.has("hidden")
    || attributes.get("aria-hidden") === "true"
    || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/iu.test(attributes.get("style") ?? "")) continue;
			if (node.tagName === "a") {
				const href = attributes.get("href");
				if (href !== undefined) urls.push(href);
			}
		}
		if ("childNodes" in node) {
			for (let index = node.childNodes.length - 1; index >= 0; index--) pending.push(node.childNodes[index]!);
		}
	}
	return urls;
}

/** Inspect the server-rendered sample, without fetching links or executing HTML. */
export function inspectRenderedCampaignContent(rendered: string, contentType?: string): {
	hasUnsubscribeLink: boolean;
	linksToCheck: string[];
	skippedControlLinks: number;
} {
	if (!rendered.trim() || rendered.length > MAX_RENDERED_CAMPAIGN_CHARACTERS) {
		throw new Error(
			"Campaign preview must be nonempty and at most 2000000 characters",
		);
	}
	const candidates = contentType === "plain"
		? (rendered.match(/https?:\/\/[^\s<>"']+/gu) ?? []).map((url) =>
				url.replace(/[.,;!?)]*$/u, ""),
			)
		: renderedAnchorUrls(rendered);
	const urls = [...new Set(candidates)].map(absoluteWebUrl).filter(
		(url): url is URL => url !== undefined,
	);
	return {
  // This proves native route presence, not server reachability or every personalized variant.
  hasUnsubscribeLink: urls.some((url) => SUBSCRIPTION_PATH.test(url.pathname)),
  linksToCheck: [...new Set(urls.filter((url) => !isCampaignControlLink(url)).map((url) => url.href))],
  skippedControlLinks: urls.filter(isCampaignControlLink).length,
 };
}
