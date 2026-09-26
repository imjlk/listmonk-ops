import { describe, expect, test } from "bun:test";
import {
	isResourceMissingError,
	ResourceResponseError,
} from "../src/resource-helpers";

function responseError(
	status: number,
	serverMessage: string,
	context = "Failed to get subscriber",
): ResourceResponseError {
	return new ResourceResponseError(`${context}: ${serverMessage}`, {
		status,
		cause: { message: serverMessage },
	});
}

describe("isResourceMissingError", () => {
	test("accepts Listmonk 6.2's 400 answer for the expected resource", () => {
		expect(
			isResourceMissingError(
				responseError(400, "Subscriber (42: ) not found"),
				"subscriber",
			),
		).toBe(true);
		expect(
			isResourceMissingError(responseError(400, "Template not found"), "template"),
		).toBe(true);
	});

	test("matches the server answer, not the caller's context", () => {
		// The wrapper message names the subscriber whatever the server said.
		expect(
			isResourceMissingError(responseError(400, "Template not found"), "subscriber"),
		).toBe(false);
		expect(
			isResourceMissingError(
				responseError(400, "Subscriber list not found"),
				"subscriber",
			),
		).toBe(false);
		expect(
			isResourceMissingError(responseError(400, "Subscriber list not found"), "list"),
		).toBe(true);
		expect(
			isResourceMissingError(responseError(400, "Blocklist entry not found"), "list"),
		).toBe(false);
	});

	test("scopes 404s only when the caller names a resource", () => {
		const proxyMiss = responseError(404, "404 page not found");
		expect(isResourceMissingError(proxyMiss, "subscriber")).toBe(false);
		expect(isResourceMissingError(proxyMiss)).toBe(true);
		expect(
			isResourceMissingError(responseError(404, "subscriber not found"), "subscriber"),
		).toBe(true);

		// Local lookups raise their own 404 without a server cause.
		const localMiss = new ResourceResponseError("Bounce 7 not found", {
			status: 404,
		});
		expect(isResourceMissingError(localMiss, "bounce")).toBe(true);
		expect(isResourceMissingError(localMiss, "subscriber")).toBe(false);
	});

	test("rejects other statuses and non-miss answers", () => {
		expect(
			isResourceMissingError(responseError(500, "Subscriber not found"), "subscriber"),
		).toBe(false);
		expect(isResourceMissingError(responseError(400, "Invalid ID"))).toBe(false);
		expect(
			isResourceMissingError(
				new ResourceResponseError(
					"Failed to get subscriber: received empty data",
					{ status: 400 },
				),
				"subscriber",
			),
		).toBe(false);
		expect(isResourceMissingError(new Error("Subscriber not found"))).toBe(false);
		// Untyped callers cannot turn the label into a pattern.
		expect(
			isResourceMissingError(
				responseError(400, "Subscriber (42: ) not found"),
				"subscriber(" as never,
			),
		).toBe(false);
		expect(
			isResourceMissingError(
				responseError(400, "Subscriber (42: ) not found"),
				"constructor" as never,
			),
		).toBe(false);
	});
});
