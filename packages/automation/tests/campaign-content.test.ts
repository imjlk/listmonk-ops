import { expect, test } from "bun:test";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	inspectRenderedCampaignContent,
	MAX_RENDERED_CAMPAIGN_CHARACTERS,
} from "../src/campaign-content";
import { checkLink, runCampaignPreflight } from "../src/campaign";
const route = "https://newsletter.test/subscription/00000000-0000-0000-0000-000000000000/00000000-0000-0000-0000-000000000000";
const anchor = `<a href="${route}">수신 거부</a>`;
function fixture(rendered: unknown, body = "<p>Hello</p>", contentType = "html") {
	return {
	 campaign: {
		 getById: async () => ({
			 data: {
				 id: 1,
				 name: "Preview",
				 subject: "Hello",
				 body,
				 content_type: contentType,
				 status: "draft",
				 updated_at: "2026-09-25T00:00:00Z",
				 lists: [{ id: 1 }],
				 template_id: 1,
			 },
		 }),
		 preview: async () => ({ data: rendered }),
	 },
	 list: { getById: async () => ({ data: { id: 1, subscriber_count: 100 } }) },
	 template: {
		 getById: async () => ({
			 data: {
				 id: 1,
				 body: '{{ template "content" . }}<a href="{{ UnsubscribeURL }}">Leave</a>',
			 },
		 }),
	 },
 } as unknown as ListmonkClient;
}
const check = (result: Awaited<ReturnType<typeof runCampaignPreflight>>, id: string) => result.checks.find(
	(item) => item.id === id,
);

test("an unsubscribe word without a real link cannot pass", async () => {
 const result = await runCampaignPreflight(fixture("Please unsubscribe whenever you like."), 1);
 expect(check(result, "unsubscribe_link")?.level).toBe("fail");
});
test("unsubscribe in the rendered template footer passes without a body marker", async () => {
 const result = await runCampaignPreflight(fixture(`<main>Hello</main><footer>${anchor}</footer>`), 1);
 expect(result.summary.fail).toBe(0);
});
test("balanced braces do not hide a server-side render failure", async () => {
 const client = fixture("");
 client.campaign.preview = async () => { throw new Error("private@example.test template secret"); };
 const result = await runCampaignPreflight(client, 1);
 expect(check(result, "template_tokens")?.level).toBe("fail");
 expect(JSON.stringify(result)).not.toContain("private@example.test");
});
test("plain campaigns validate the rendered native URL without HTML", async () => {
 const result = await runCampaignPreflight(fixture(`Leave this list: ${route}`, "Hello", "plain"), 1);
 expect(check(result, "unsubscribe_link")?.level).toBe("pass");
});
test("plain campaigns inspect visible text and usable rendered anchors", () => {
	for (const html of [
		`<!-- ${route} -->`, `<script>${route}</script>`, `<div hidden>${route}</div>`,
		`<a href="${route}"></a>`, `<head><title>${route}</title></head><body>Hello</body>`,
	]) {
		expect(inspectRenderedCampaignContent(html, "plain").hasUnsubscribeLink).toBe(false);
	}
	expect(inspectRenderedCampaignContent(`<div>Leave: ${route}</div>`, "plain").hasUnsubscribeLink).toBe(true);
	expect(inspectRenderedCampaignContent(`<div>Leave: ${route.replace("https://", "HTTPS://")}</div>`, "plain").hasUnsubscribeLink).toBe(true);
	expect(inspectRenderedCampaignContent(`<footer><a href="${route}">Leave</a></footer>`, "plain").hasUnsubscribeLink).toBe(true);
	expect(inspectRenderedCampaignContent('<head><meta content="https://example.test/private"></head><body>Hello</body>', "plain").linksToCheck).toEqual([]);
});
test("plain previews retain bracketed URLs without accepting hidden markup", () => {
	expect(inspectRenderedCampaignContent(`Unsubscribe: <${route}>`, "plain").hasUnsubscribeLink).toBe(
		true,
	);
	expect(inspectRenderedCampaignContent(`<!-- <${route}> --><p>Hello</p>`, "plain").hasUnsubscribeLink).toBe(
		false,
	);
	expect(inspectRenderedCampaignContent(`<script>const url = "<${route}>";</script><p>Hello</p>`, "plain").hasUnsubscribeLink).toBe(
		false,
	);
});
test("plain preview anchor labels do not substitute for their href destinations", () => {
	const result = inspectRenderedCampaignContent(
		`<a href="https://example.test/page">${route}</a>`,
		"plain",
	);
	expect(result.hasUnsubscribeLink).toBe(false);
	expect(result.linksToCheck).toEqual(["https://example.test/page"]);
});
test("plain URL extraction preserves valid trailing path characters", () => {
	const url = "https://example.test/wiki/Function_(mathematics)";
	expect(inspectRenderedCampaignContent(`Read ${url}`, "plain").linksToCheck).toEqual(
		[url],
	);
	expect(inspectRenderedCampaignContent(`Read (${url})`, "plain").linksToCheck).toEqual(
		[url],
	);
	expect(inspectRenderedCampaignContent("Read https://example.test/action!", "plain").linksToCheck).toEqual(
		["https://example.test/action!"],
	);
});
test("plain sentence punctuation does not invalidate native unsubscribe URLs", () => {
	for (const punctuation of [".", ",", ";", ").", "]."]) {
		expect(inspectRenderedCampaignContent(`Unsubscribe: ${route}${punctuation}`, "plain").hasUnsubscribeLink).toBe(
			true,
		);
	}
	expect(inspectRenderedCampaignContent("Read https://example.test/action!", "plain").linksToCheck).toEqual(
		["https://example.test/action!"],
	);
});
test("empty and hidden-only anchors cannot satisfy unsubscribe", () => {
	for (const html of [`<a href="${route}"></a>`, `<a href="${route}"><span hidden>Leave</span></a>`, `<div inert><a href="${route}">Leave</a></div>`, `<a href="${route}">&#8203;</a>`, `<a href="${route}">\u00ad\ufe0f</a>`]) {
		expect(inspectRenderedCampaignContent(html).hasUnsubscribeLink).toBe(false);
	}
	expect(inspectRenderedCampaignContent(`<a href="${route}">\u200bLeave</a>`).hasUnsubscribeLink).toBe(
		true,
	);
	expect(inspectRenderedCampaignContent(`<a href="${route}" aria-label="&#8203;"></a>`).hasUnsubscribeLink).toBe(
		false,
	);
	expect(inspectRenderedCampaignContent(`<a href="${route}" aria-label="\u200bLeave"></a>`).hasUnsubscribeLink).toBe(
		true,
	);
	expect(inspectRenderedCampaignContent(`<a href="${route}"><img src="/leave.png" alt="Leave"></a>`).hasUnsubscribeLink).toBe(
		true,
	);
});
test("comments, scripts, inert templates and explicitly hidden links cannot satisfy the check", () => {
 for (const html of [`<!-- ${anchor} -->`, `<script>${anchor}</script>`, `<template>${anchor}</template>`, `<div hidden>${anchor}</div>`, `<div style="display:none">${anchor}</div>`]) {
  expect(inspectRenderedCampaignContent(html).hasUnsubscribeLink).toBe(false);
 }
});
test("HTML entity decoding preserves ordinary links and excludes native control URLs", () => {
	const result = inspectRenderedCampaignContent(
		`${anchor}<a href="https://example.test/page?a=1&amp;b=2">Page</a>`,
	);
	expect(result.hasUnsubscribeLink).toBe(true);
	expect(result.linksToCheck).toEqual(["https://example.test/page?a=1&b=2"]);
	expect(result.skippedControlLinks).toBe(1);
});
test("credential and tracking links are never included in the link-check set", () => {
	const links = [
		route,
		`${route}?manage=true`,
		"https://newsletter.test/subscription/optin/id",
		"https://newsletter.test/link/00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000002/00000000-0000-0000-0000-000000000003",
		"https://example.test/reset/token",
		"https://example.test/action?token=secret",
		"https://example.test/download?api_key=secret",
		"https://example.test/download?reset_token=secret",
		"https://example.test/download?jwt=secret",
		"https://example.test/download?auth_code=secret",
	];
	const result = inspectRenderedCampaignContent(
		links.map((href) => `<a href="${href}">Link</a>`).join(""),
	);
	expect(result.linksToCheck).toEqual([]);
	expect(result.skippedControlLinks).toBe(links.length);
});
test("ordinary author and zipcode parameters remain eligible for link checks", () => {
	const links = [
		"https://example.test/article?author=alice",
		"https://example.test/store?zipcode=10001",
		"https://example.test/tools?tokenizer=word",
		"https://example.test/team?secretary=amy",
		"https://example.test/account?passwordless=true",
	];
	const result = inspectRenderedCampaignContent(
		links.map((href) => `<a href="${href}">Link</a>`).join(""),
	);
	expect(result.linksToCheck).toEqual(links);
	expect(result.skippedControlLinks).toBe(0);
});
test("ordinary third-party link paths remain eligible for link checks", () => {
	const href = "https://example.test/link/documentation";
	expect(inspectRenderedCampaignContent(`<a href="${href}">Documentation</a>`).linksToCheck).toEqual(
		[href],
	);
});
test("redirects to control links are blocked before the target is fetched", async () => {
	let requests = 0;
	const result = await checkLink("https://example.com/start", 5_000, {
		lookupHost: async () => [{ address: "93.184.216.34", family: 4 }],
		send: async () => {
			requests++;
			return { status: 302, location: route };
		},
	});
	expect(result.ok).toBe(false);
	expect(result.error).toContain("campaign control link");
	expect(requests).toBe(1);
});
test("raw words, unsupported schemes, URL credentials and unresolved expressions do not count", () => {
 for (const href of ["javascript:unsubscribe()", "{{ UnsubscribeURL }}", "mailto:unsubscribe@example.test", route.replace("https://", "https://user:pass@"), "https://example.test/unsubscribe"]) {
  expect(inspectRenderedCampaignContent(`<a href="${href}">Unsubscribe</a>`).hasUnsubscribeLink).toBe(false);
 }
});
test("oversized and empty previews fail closed", () => {
 expect(() => inspectRenderedCampaignContent(" ")).toThrow();
 expect(() => inspectRenderedCampaignContent("x".repeat(MAX_RENDERED_CAMPAIGN_CHARACTERS + 1))).toThrow();
});
test("link-check mode does not fetch the rendered unsubscribe URL", async () => {
	let lookups = 0;
	let requests = 0;
	const result = await runCampaignPreflight(fixture(anchor), 1, {
		checkLinks: true,
		linkCheck: {
			lookupHost: async () => {
				lookups++;
				return [{ address: "93.184.216.34", family: 4 }];
			},
			send: async () => {
				requests++;
				return { status: 200 };
			},
		},
	});
	expect(check(result, "unsubscribe_link")?.level).toBe("pass");
	expect(check(result, "link_health")?.details).toMatchObject({ skippedControlLinks: 1 });
	expect(lookups).toBe(0);
	expect(requests).toBe(0);
});
