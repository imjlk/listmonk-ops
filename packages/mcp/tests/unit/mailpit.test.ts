import { expect, test } from "bun:test";
import { fetchMailpitJson, findMailpitMessage } from "../e2e/mailpit.js";

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

test("Mailpit helper searches for the exact recipient and subject", async () => {
	const previousMailpitApiUrl = process.env.MAILPIT_API_URL;
	const recipient = "recipient@example.com";
	const subject = "Transactional subject";
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			const url = new URL(request.url);
			expect(url.pathname).toBe("/api/v1/search");
			expect(url.searchParams.get("query")).toBe(
				`to:"${recipient}" subject:"${subject}"`,
			);
			return Response.json({
				messages: [
					{
						ID: "matching-message",
						Subject: subject,
						To: [{ Address: recipient }],
					},
				],
			});
		},
	});

	try {
		process.env.MAILPIT_API_URL = `http://127.0.0.1:${server.port}/api/v1`;
		await expect(findMailpitMessage(recipient, subject)).resolves.toMatchObject({
			ID: "matching-message",
			Subject: subject,
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
