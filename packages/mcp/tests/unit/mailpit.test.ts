import { expect, test } from "bun:test";
import { fetchMailpitJson } from "../e2e/mailpit.js";

test("Mailpit helper resolves its API URL after test env setup", async () => {
	const previousMailpitApiUrl = process.env.MAILPIT_API_URL;
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			expect(new URL(request.url).pathname).toBe("/api/v1/messages");
			return Response.json({ messages: [] });
		},
	});

	try {
		process.env.MAILPIT_API_URL = `http://127.0.0.1:${server.port}/api/v1`;
		await expect(fetchMailpitJson<{ messages: [] }>("/messages")).resolves.toEqual({
			messages: [],
		});
	} finally {
		server.stop(true);
		if (previousMailpitApiUrl === undefined) {
			delete process.env.MAILPIT_API_URL;
		} else {
			process.env.MAILPIT_API_URL = previousMailpitApiUrl;
		}
	}
});
