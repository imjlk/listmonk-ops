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
		/(?:token|secret|password|passwd|signature|apikey|accesskey|jwt|auth|otp|code|^key$|^sig$)/iu.test(
			key.replace(/[-_.]/gu, ""),
		),
	);
}

function hiddenElement(node: HtmlNode): boolean {
	if (!("tagName" in node)) return false;
	const attributes = new Map(
		node.attrs.map((attribute) => [attribute.name, attribute.value]),
	);
	return INERT_ELEMENTS.has(node.tagName) || attributes.has("hidden")
		|| attributes.get("aria-hidden") === "true"
		|| /(?:display\s*:\s*none|visibility\s*:\s*hidden)/iu.test(attributes.get("style") ?? "");
}

function usableAnchorContent(node: HtmlNode): boolean {
	if (hiddenElement(node)) return false;
	if ("value" in node && node.nodeName === "#text") return node.value.trim().length > 0;
	if ("tagName" in node && node.tagName === "img") {
		return node.attrs.some(
			(attribute) => attribute.name === "src" && attribute.value.trim().length > 0,
		);
	}
	return "childNodes" in node && node.childNodes.some(usableAnchorContent);
}

function renderedVisibleUrls(html: string): { anchors: string[]; text: string[] } {
	const pending: HtmlNode[] = [parse(html)];
	const anchors: string[] = [];
	const text: string[] = [];
	while (pending.length > 0) {
		const node = pending.pop()!;
		if (hiddenElement(node)) continue;
		if ("value" in node && node.nodeName === "#text") text.push(node.value);
		if ("tagName" in node && node.tagName === "a") {
			const attributes = new Map(
				node.attrs.map((attribute) => [attribute.name, attribute.value]),
			);
			const href = attributes.get("href");
			if (href !== undefined && (
				(attributes.get("aria-label")?.trim().length ?? 0) > 0
				|| node.childNodes.some(usableAnchorContent)
			)) anchors.push(href);
		}
		if ("childNodes" in node) {
			for (let index = node.childNodes.length - 1; index >= 0; index--) pending.push(node.childNodes[index]!);
		}
	}
	return { anchors, text };
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
	const visible = renderedVisibleUrls(rendered);
	const candidates = contentType === "plain"
		? visible.text.flatMap((part) =>
				(part.match(/https?:\/\/[^\s<>"']+/gu) ?? []).map((url) =>
					url.replace(/[.,;!?)]*$/u, ""),
				),
			)
		: visible.anchors;
	const urls = [...new Set(candidates)].map(absoluteWebUrl).filter(
		(url): url is URL => url !== undefined,
	);
	return {
		hasUnsubscribeLink: urls.some((url) => SUBSCRIPTION_PATH.test(url.pathname)),
		linksToCheck: [
			...new Set(urls.filter((url) => !isCampaignControlLink(url)).map((url) => url.href)),
		],
		skippedControlLinks: urls.filter(isCampaignControlLink).length,
	};
}
