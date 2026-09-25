import { parse, type DefaultTreeAdapterMap } from "parse5";

type HtmlNode = DefaultTreeAdapterMap["node"];
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const SUBSCRIPTION_PATH = new RegExp(`/subscription/${UUID}/${UUID}/?$`);
const TRACKING_LINK_PATH = new RegExp(
	`(?:^|/)link/${UUID}/${UUID}/${UUID}/?$`,
	"u",
);
const INERT_ELEMENTS = new Set([
	"head",
	"script",
	"style",
	"template",
	"noscript",
]);
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
	if (/(?:^|\/)(?:subscription|unsubscribe|optin|login|auth|oauth|reset|verify|confirm)(?:\/|$)/u.test(path)) return true;
	if (TRACKING_LINK_PATH.test(path)) return true;
	if (/\/campaign\/[^/]+\/[^/]+\/px\.png$/u.test(path)) return true;
	return [...url.searchParams.keys()].some((key) => {
		const normalized = key.replace(/[-_.]/gu, "").toLowerCase();
		return /^(?:(?:access|refresh|reset|session|auth|id|csrf|xsrf|verification|confirm|invite|api|client)?token|(?:api|client)?secret|(?:new|old|current)?password|passwd|signature|apikey|accesskey|jwt|auth|authorization|otp|(?:auth|oauth|authorization|verification|reset|invite|otp)?code|key|sig)$/u.test(
			normalized,
		);
	});
}

function hasMeaningfulText(value: string): boolean {
	return value.replace(/[\s\p{Default_Ignorable_Code_Point}]/gu, "").length > 0;
}

function hiddenElement(node: HtmlNode): boolean {
	if (!("tagName" in node)) return false;
	const attributes = new Map(
		node.attrs.map((attribute) => [attribute.name, attribute.value]),
	);
	return INERT_ELEMENTS.has(node.tagName) || attributes.has("hidden") || attributes.has("inert")
		|| attributes.get("aria-hidden") === "true"
		|| /(?:display\s*:\s*none|visibility\s*:\s*hidden)/iu.test(attributes.get("style") ?? "");
}

function usableAnchorContent(node: HtmlNode): boolean {
	if (hiddenElement(node)) return false;
	if ("value" in node && node.nodeName === "#text") return hasMeaningfulText(node.value);
	if ("tagName" in node && node.tagName === "img") {
		return node.attrs.some(
			(attribute) => attribute.name === "src" && attribute.value.trim().length > 0,
		);
	}
	return "childNodes" in node && node.childNodes.some(usableAnchorContent);
}

function renderedVisibleUrls(html: string): { anchors: string[]; text: string[] } {
	const pending: Array<{ node: HtmlNode; insideAnchor: boolean }> = [
		{ node: parse(html), insideAnchor: false },
	];
	const anchors: string[] = [];
	const text: string[] = [];
	while (pending.length > 0) {
		const { node, insideAnchor } = pending.pop()!;
		if (hiddenElement(node)) continue;
		if (!insideAnchor && "value" in node && node.nodeName === "#text") text.push(node.value);
		if ("tagName" in node && node.tagName === "a") {
			const attributes = new Map(
				node.attrs.map((attribute) => [attribute.name, attribute.value]),
			);
			const href = attributes.get("href");
			const label = attributes.get("aria-label");
			if (href !== undefined && (
				(label !== undefined && hasMeaningfulText(label))
				|| node.childNodes.some(usableAnchorContent)
			)) anchors.push(href);
		}
		if ("childNodes" in node) {
			for (let index = node.childNodes.length - 1; index >= 0; index--) pending.push({
				node: node.childNodes[index]!,
				insideAnchor: insideAnchor || ("tagName" in node && node.tagName === "a"),
			});
		}
	}
	return { anchors, text };
}

function stripUnmatchedClosingDelimiters(value: string): string {
	const balance: Record<string, number> = { ")": 0, "]": 0, "}": 0 };
	const closingFor: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
	for (const character of value) {
		const closing = closingFor[character];
		if (closing) balance[closing]! += 1;
		else if (character in balance) balance[character]! -= 1;
	}
	let end = value.length;
	while (end > 0) {
		const closing = value[end - 1]!;
		if (!(closing in balance) || balance[closing]! >= 0) break;
		balance[closing]! += 1;
		end--;
	}
	return value.slice(0, end);
}

function stripSurroundingUrlPunctuation(value: string): string {
	let current = value;
	let previous: string;
	do {
		previous = current;
		current = stripUnmatchedClosingDelimiters(current.replace(/[.,;]+$/u, ""));
	} while (current !== previous);
	return current;
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
		? [...visible.anchors, ...visible.text.flatMap((part) =>
				(part.match(/https?:\/\/[^\s<>"']+/giu) ?? []).map((url) =>
					stripSurroundingUrlPunctuation(url),
				),
			)]
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
