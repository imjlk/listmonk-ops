import { describe, expect, test } from "bun:test";
import { normalizeListmonkApiUrl } from "../src";

describe("normalizeListmonkApiUrl", () => {
	test("appends the /api suffix when missing", () => {
		expect(normalizeListmonkApiUrl("http://localhost:9000")).toBe(
			"http://localhost:9000/api",
		);
	});

	test("preserves an existing /api suffix", () => {
		expect(normalizeListmonkApiUrl("http://localhost:9000/api")).toBe(
			"http://localhost:9000/api",
		);
	});

	test("drops a trailing slash before appending /api", () => {
		expect(normalizeListmonkApiUrl("http://localhost:9000/")).toBe(
			"http://localhost:9000/api",
		);
		expect(normalizeListmonkApiUrl("http://localhost:9000/api/")).toBe(
			"http://localhost:9000/api",
		);
	});

	test("preserves a reverse-proxy path prefix", () => {
		expect(normalizeListmonkApiUrl("https://host/custom")).toBe(
			"https://host/custom/api",
		);
		expect(normalizeListmonkApiUrl("https://host/custom/api")).toBe(
			"https://host/custom/api",
		);
	});

	test("trims surrounding whitespace", () => {
		expect(normalizeListmonkApiUrl("  http://localhost:9000/api  ")).toBe(
			"http://localhost:9000/api",
		);
	});

	test("rejects an empty URL", () => {
		expect(() => normalizeListmonkApiUrl("")).toThrow(
			/Listmonk API URL is required/,
		);
		expect(() => normalizeListmonkApiUrl("   ")).toThrow(
			/Listmonk API URL is required/,
		);
	});

	test("rejects an invalid URL", () => {
		expect(() => normalizeListmonkApiUrl("not-a-url")).toThrow(
			/Invalid Listmonk API URL/,
		);
	});

	test("rejects a URL with a query string", () => {
		// Naively appending /api would produce ...?tenant=1/api, mis-targeting
		// the request. Reject up front so the misconfiguration is visible.
		expect(() =>
			normalizeListmonkApiUrl("https://host/api?tenant=1"),
		).toThrow(/must not include a query string or fragment/);
	});

	test("rejects a URL with a fragment", () => {
		expect(() =>
			normalizeListmonkApiUrl("https://host/api#section"),
		).toThrow(/must not include a query string or fragment/);
	});
});
