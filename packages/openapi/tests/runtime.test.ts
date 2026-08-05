import { describe, expect, mock, spyOn, test } from "bun:test";
import {
	createListmonkRuntimeClient,
	createListmonkTokenAuthorization,
	ListmonkRuntimeError,
	normalizeListmonkApiBaseUrl,
	sendExternalTransactionalEmail,
} from "../runtime";

describe("Workers-compatible Listmonk runtime", () => {
	test("normalizes origins and mounted paths to one API suffix", () => {
		expect(normalizeListmonkApiBaseUrl("https://mail.example.com")).toBe(
			"https://mail.example.com/api",
		);
		expect(normalizeListmonkApiBaseUrl("https://mail.example.com/api/")).toBe(
			"https://mail.example.com/api",
		);
		expect(
			normalizeListmonkApiBaseUrl("https://mail.example.com/listmonk/"),
		).toBe("https://mail.example.com/listmonk/api");
	});

	test("rejects ambiguous URLs and malformed token credentials", () => {
		for (const value of [
			"ftp://mail.example.com",
			"http://mail.example.com",
			"https://mail.example.com\n.evil.test",
			"https://mail.example.com\u200b.evil.test",
			"https://mail.example.com\u00ad.evil.test",
			"https://mail.example.com\u2060.evil.test",
			"https://mail.example.com\ufe0f.evil.test",
			"https://mail.example.com\u034f.evil.test",
			"https://mail.example.com%E2%80%8B.evil.test",
			"https://mail.example.com%C2%AD.evil.test",
			"https://mail.example.com%00.evil.test",
			"https://mail.example.com%EF%B8%8F.evil.test",
			"https:////mail.example.com",
			"https:////mail.example.com%E2%80%8B.evil.test",
			"https://user\\@mail.example.com",
			"https://edge.example.com/listmonk/%2e%2e/private",
			"https://edge.example.com/listmonk/../private",
			"https://user:password@mail.example.com",
			"https://mail.example.com?token=secret",
			"https://mail.example.com#fragment",
		]) {
			expect(() => normalizeListmonkApiBaseUrl(value)).toThrow(
				ListmonkRuntimeError,
			);
		}
		expect(() => createListmonkTokenAuthorization("bad:user", "token")).toThrow(
			"Listmonk username must not contain a colon.",
		);
		expect(() =>
			createListmonkTokenAuthorization("runtime", " token"),
		).toThrow("must not contain surrounding whitespace");
		expect(() =>
			createListmonkTokenAuthorization("runtime", "token\nvalue"),
		).toThrow("must not contain control or invisible formatting characters");
		expect(() =>
			createListmonkTokenAuthorization("run\u200btime", "token"),
		).toThrow("must not contain control or invisible formatting characters");
		expect(() =>
			createListmonkTokenAuthorization("runtime", "token-🔒"),
		).toThrow("must contain only printable ASCII characters");
		expect(() => normalizeListmonkApiBaseUrl(undefined as never)).toThrow(
			ListmonkRuntimeError,
		);
		expect(() =>
			createListmonkTokenAuthorization(undefined as never, "token"),
		).toThrow(ListmonkRuntimeError);
		expect(() => createListmonkRuntimeClient(undefined as never)).toThrow(
			ListmonkRuntimeError,
		);
		expect(() =>
			createListmonkRuntimeClient({
				accessToken: "test-token",
				get baseUrl(): string {
					throw new Error("private accessor error");
				},
				username: "runtime",
			}),
		).toThrow(ListmonkRuntimeError);
		expect(() =>
			createListmonkRuntimeClient({
				baseUrl: "https://mail.example.com",
				username: "runtime",
				accessToken: "test-token",
				fetch: "not-fetch" as never,
			}),
		).toThrow(ListmonkRuntimeError);
	});

	test("sends one external message without subscriber persistence", async () => {
		let captured: Request | undefined;
		let capturedInit: RequestInit | undefined;
		const fetch = mock(async (request: Request, init?: RequestInit) => {
			captured = request;
			capturedInit = init;
			return Response.json({ data: true });
		});
		const client = createListmonkRuntimeClient({
			baseUrl: "https://mail.example.com",
			username: "runtime",
			accessToken: "test-token",
			fetch,
		});

		await expect(
			sendExternalTransactionalEmail({
				client,
				templateId: 42,
				recipient: "trainer@example.com",
				subject: 'Your sign-in code: "123,456"',
				data: { otp: "123456", expiresMinutes: 5 },
			}),
		).resolves.toEqual({ sent: true, status: 200 });

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(captured?.url).toBe("https://mail.example.com/api/tx");
		expect(captured?.headers.get("Authorization")).toBe(
			"token runtime:test-token",
		);
		expect(await captured?.json()).toEqual({
			template_id: 42,
			subscriber_mode: "external",
			subscriber_emails: ["trainer@example.com"],
			subject: 'Your sign-in code: "123,456"',
			data: { otp: "123456", expiresMinutes: 5 },
		});
		expect(captured?.signal.aborted).toBe(false);
		expect(captured?.redirect).toBe("error");
		expect(capturedInit?.redirect).toBe("error");
	});

	test("allows a single local-domain recipient for private Mailpit stacks", async () => {
		const fetch = mock(async () => Response.json({ data: true }));
		const client = createListmonkRuntimeClient({
			baseUrl: "https://listmonk.internal",
			username: "runtime",
			accessToken: "test-token",
			fetch,
		});

		await expect(
			sendExternalTransactionalEmail({
				client,
				templateId: 42,
				recipient: "trainer@mailpit",
			}),
		).resolves.toEqual({ sent: true, status: 200 });
	});

	test("allows shared non-cyclic references in template data", async () => {
		const fetch = mock(async () => Response.json({ data: true }));
		const client = createListmonkRuntimeClient({
			baseUrl: "https://mail.example.com",
			username: "runtime",
			accessToken: "test-token",
			fetch,
		});
		const shared = { code: "123456" };

		await expect(
			sendExternalTransactionalEmail({
				client,
				templateId: 42,
				recipient: "trainer@example.com",
				data: { primary: shared, fallback: shared },
			}),
		).resolves.toEqual({ sent: true, status: 200 });
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	test("snapshots top-level fields and validated data before sending", async () => {
		let captured: Request | undefined;
		const fetch = mock(async (request: Request) => {
			captured = request;
			return Response.json({ data: true });
		});
		const client = createListmonkRuntimeClient({
			baseUrl: "https://mail.example.com",
			username: "runtime",
			accessToken: "test-token",
			fetch,
		});
		let templateReads = 0;
		let dataReads = 0;
		const input = {
			client,
			get data() {
				dataReads += 1;
				return dataReads === 1 ? { code: "123456" } : { code: Number.NaN };
			},
			recipient: "trainer@example.com",
			get templateId() {
				templateReads += 1;
				return templateReads === 1 ? 42 : 0;
			},
		};

		await expect(sendExternalTransactionalEmail(input)).resolves.toEqual({
			sent: true,
			status: 200,
		});
		expect(templateReads).toBe(1);
		expect(dataReads).toBe(1);
		expect(await captured?.json()).toMatchObject({
			template_id: 42,
			data: { code: "123456" },
		});
	});

	test("allows a literal toJSON template field without invoking it", async () => {
		let captured: Request | undefined;
		const fetch = mock(async (request: Request) => {
			captured = request;
			return Response.json({ data: true });
		});
		const client = createListmonkRuntimeClient({
			baseUrl: "https://mail.example.com",
			username: "runtime",
			accessToken: "test-token",
			fetch,
		});

		await sendExternalTransactionalEmail({
			client,
			data: { toJSON: "literal" },
			recipient: "trainer@example.com",
			templateId: 42,
		});
		expect(await captured?.json()).toMatchObject({
			data: { toJSON: "literal" },
		});
	});

	test("keeps the generated client and factory fetch behind an opaque handle", async () => {
		let captured: Request | undefined;
		const fetch = mock(async (request: Request) => {
			captured = request;
			return Response.json({ data: true });
		});
		const client = createListmonkRuntimeClient({
			baseUrl: "https://mail.example.com",
			username: "runtime",
			accessToken: "test-token",
			fetch,
		});
		expect(Object.isFrozen(client)).toBe(true);
		expect(Object.keys(client)).toEqual([]);
		expect("setConfig" in client).toBe(false);
		expect("interceptors" in client).toBe(false);
		expect(Reflect.set(client, "fetch", mock(() => undefined))).toBe(false);

		await expect(
			sendExternalTransactionalEmail({
				client,
				templateId: 42,
				recipient: "trainer@example.com",
			}),
		).resolves.toEqual({ sent: true, status: 200 });
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(captured?.headers.get("Authorization")).toBe(
			"token runtime:test-token",
		);
		expect(await captured?.json()).toEqual({
			template_id: 42,
			subscriber_mode: "external",
			subscriber_emails: ["trainer@example.com"],
		});
	});

	test("rejects a counterfeit runtime client before sending", async () => {
		const fetch = mock(async () => Response.json({ data: true }));
		const client = createListmonkRuntimeClient({
			baseUrl: "https://mail.example.com",
			username: "runtime",
			accessToken: "test-token",
			fetch,
		});
		const counterfeit = { ...client };

		await expect(
			sendExternalTransactionalEmail({
				client: counterfeit,
				templateId: 42,
				recipient: "trainer@example.com",
			}),
		).rejects.toMatchObject({ code: "invalid_configuration" });
		expect(fetch).not.toHaveBeenCalled();
	});

	test("rejects invalid message fields before calling Listmonk", async () => {
		const fetch = mock(async () => Response.json({ data: true }));
		const client = createListmonkRuntimeClient({
			baseUrl: "https://mail.example.com",
			username: "runtime",
			accessToken: "test-token",
			fetch,
		});
		await expect(
			sendExternalTransactionalEmail(undefined as never),
		).rejects.toMatchObject({ code: "invalid_message" });
		const inaccessibleMessage = {
			client,
			recipient: "trainer@example.com",
			get templateId(): number {
				throw new Error("private accessor error");
			},
		};
		const inaccessibleError = await sendExternalTransactionalEmail(
			inaccessibleMessage,
		).catch((cause: unknown) => cause);
		expect(inaccessibleError).toMatchObject({ code: "invalid_message" });
		expect(String(inaccessibleError)).not.toContain("private accessor error");

		for (const message of [
			{ client, templateId: 0, recipient: "trainer@example.com" },
			{
				client,
				templateId: 42,
				recipient: "trainer@example.com",
				timeoutMs: 0,
			},
			{
				client,
				templateId: 42,
				recipient: "trainer@example.com",
				timeoutMs: 2_147_483_648,
			},
			{
				client,
				templateId: 42,
				recipient: "trainer@example.com",
				signal: {} as never,
			},
			{ client, templateId: 42, recipient: "two@example.com,three@example.com" },
			{ client, templateId: 42, recipient: "two,three@example.com" },
			{ client, templateId: 42, recipient: '\"><injected>@evil.com' },
			{ client, templateId: 42, recipient: undefined as never },
			{ client, templateId: 42, recipient: `${"a".repeat(250)}@x.com` },
			{ client, templateId: 42, recipient: "trainer@exam\u200bple.com" },
			{ client, templateId: 42, recipient: "trainer@example.com/path" },
			{ client, templateId: 42, recipient: "trainer@example..com" },
			{ client, templateId: 42, recipient: "trainer@-example.com" },
			{ client, templateId: 42, recipient: "trainer@example-.com" },
			{ client, templateId: 42, recipient: ".trainer@example.com" },
			{ client, templateId: 42, recipient: "trainer.@example.com" },
			{ client, templateId: 42, recipient: "train..er@example.com" },
			{ client, templateId: 42, recipient: `${"a".repeat(65)}@example.com` },
			{
				client,
				templateId: 42,
				recipient: "trainer@example.com",
				subject: "Code\r\nBcc: hidden@example.com",
			},
			{
				client,
				templateId: 42,
				recipient: "trainer@example.com",
				subject: "Your sign-in\u202ecode",
			},
			{
				client,
				templateId: 42,
				recipient: "trainer@example.com",
				subject: "x".repeat(257),
			},
		]) {
			await expect(sendExternalTransactionalEmail(message)).rejects.toMatchObject({
				code: "invalid_message",
			});
		}
		expect(fetch).not.toHaveBeenCalled();
	});

	test("serializes once and bounds the transactional body", async () => {
		const fetch = mock(async () => Response.json({ data: true }));
		const client = createListmonkRuntimeClient({
			baseUrl: "https://mail.example.com",
			username: "runtime",
			accessToken: "test-token",
			fetch,
		});
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		const sparse = new Array<unknown>(1);
		const withToJSON = { code: "123456" };
		Object.defineProperty(withToJSON, "toJSON", {
			value: () => ({ value: Number.NaN }),
		});
		const withExtraProperty = [1] as Array<unknown> & { extra?: unknown };
		withExtraProperty.extra = undefined;
		let deep: Record<string, unknown> = {};
		const deepRoot = deep;
		for (let depth = 0; depth < 33; depth += 1) {
			const next: Record<string, unknown> = {};
			deep.next = next;
			deep = next;
		}

		for (const data of [
			"not-an-object" as never,
			[] as never,
			{ payload: "x".repeat(64 * 1024) },
			{ items: Array.from({ length: 2_049 }, () => null) },
			{ optional: undefined },
			{ value: Number.NaN },
			{ value: Number.POSITIVE_INFINITY },
			{ value: 1n },
			{ items: sparse },
			{ items: withExtraProperty },
			{ payload: withToJSON },
			deepRoot,
			circular,
		]) {
			await expect(
				sendExternalTransactionalEmail({
					client,
					templateId: 42,
					recipient: "trainer@example.com",
					data,
				}),
			).rejects.toMatchObject({ code: "invalid_message" });
		}
		for (const prototype of [Object.prototype, Array.prototype]) {
			const inheritedHookResult = (() => {
				Object.defineProperty(prototype, "toJSON", {
					configurable: true,
					value: () => ({ value: Number.NaN }),
				});
				try {
					return sendExternalTransactionalEmail({
						client,
						templateId: 42,
						recipient: "trainer@example.com",
					});
				} finally {
					Reflect.deleteProperty(prototype, "toJSON");
				}
			})();
			await expect(inheritedHookResult).rejects.toMatchObject({
				code: "invalid_message",
			});
		}
		const inheritedPrototype = Object.create(Object.prototype) as object;
		Object.defineProperty(inheritedPrototype, "toJSON", {
			configurable: true,
			value: () => ({ value: Number.NaN }),
		});
		const originalArrayPrototype = Object.getPrototypeOf(Array.prototype);
		const inheritedHookResult = (() => {
			Object.setPrototypeOf(Array.prototype, inheritedPrototype);
			try {
				return sendExternalTransactionalEmail({
					client,
					templateId: 42,
					recipient: "trainer@example.com",
				});
			} finally {
				Object.setPrototypeOf(Array.prototype, originalArrayPrototype);
			}
		})();
		await expect(inheritedHookResult).rejects.toMatchObject({
			code: "invalid_message",
		});
		expect(fetch).not.toHaveBeenCalled();
	});

	test("projects remote failures to bounded errors without recipient data", async () => {
		const fetch = mock(async () =>
			Response.json(
				{ error: "delivery failed for private@example.com" },
				{ status: 503 },
			),
		);
		const client = createListmonkRuntimeClient({
			baseUrl: "https://mail.example.com",
			username: "runtime",
			accessToken: "test-token",
			fetch,
		});
		const error = await sendExternalTransactionalEmail({
			client,
			templateId: 42,
			recipient: "private@example.com",
		}).catch((cause: unknown) => cause);

		expect(error).toBeInstanceOf(ListmonkRuntimeError);
		expect(error).toMatchObject({
			code: "request_failed",
			reason: "http_error",
			status: 503,
		});
		expect(String(error)).not.toContain("private@example.com");
	});

	test("does not classify an HTTP error body as a local abort", async () => {
		for (const name of ["AbortError", "TimeoutError"]) {
			const fetch = mock(async () => Response.json({ name }, { status: 503 }));
			const client = createListmonkRuntimeClient({
				baseUrl: "https://mail.example.com",
				username: "runtime",
				accessToken: "test-token",
				fetch,
			});

			await expect(
				sendExternalTransactionalEmail({
					client,
					templateId: 42,
					recipient: "trainer@example.com",
				}),
			).rejects.toMatchObject({
				code: "request_failed",
				reason: "http_error",
				status: 503,
			});
		}
	});

	test("preserves HTTP status when an error response body cannot be read", async () => {
		const fetch = mock(
			async () =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.error(new Error("private response body"));
						},
					}),
					{ status: 503 },
				),
		);
		const client = createListmonkRuntimeClient({
			baseUrl: "https://mail.example.com",
			username: "runtime",
			accessToken: "test-token",
			fetch,
		});

		const error = await sendExternalTransactionalEmail({
			client,
			recipient: "private@example.com",
			templateId: 42,
		}).catch((cause: unknown) => cause);

		expect(error).toMatchObject({
			code: "request_failed",
			reason: "http_error",
			status: 503,
		});
		expect(String(error)).not.toContain("private response body");
	});

	test("redacts malformed successful response bodies", async () => {
		const fetch = mock(async () =>
			new Response('{"data":"private@example.com"', {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const client = createListmonkRuntimeClient({
			baseUrl: "https://mail.example.com",
			username: "runtime",
			accessToken: "test-token",
			fetch,
		});

		const error = await sendExternalTransactionalEmail({
			client,
			templateId: 42,
			recipient: "private@example.com",
		}).catch((cause: unknown) => cause);

		expect(error).toMatchObject({
			code: "request_failed",
			reason: "response_parse_failed",
			status: 200,
		});
		expect(String(error)).not.toContain("private@example.com");
		expect((error as Error).cause).toBeUndefined();
	});

	test("preserves HTTP status when a successful response body cannot be read", async () => {
		const fetch = mock(
			async () =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.error(new Error("private success body"));
						},
					}),
					{ status: 200 },
				),
		);
		const client = createListmonkRuntimeClient({
			baseUrl: "https://mail.example.com",
			username: "runtime",
			accessToken: "test-token",
			fetch,
		});

		const error = await sendExternalTransactionalEmail({
			client,
			recipient: "private@example.com",
			templateId: 42,
		}).catch((cause: unknown) => cause);

		expect(error).toMatchObject({
			code: "request_failed",
			reason: "response_parse_failed",
			status: 200,
		});
		expect(String(error)).not.toContain("private success body");
	});

	test("bounds successful acknowledgement bodies before parsing", async () => {
		let cancelled = false;
		const chunk = new TextEncoder().encode("x".repeat(40_000));
		const fetch = mock(
			async () =>
				new Response(
					new ReadableStream({
						cancel() {
							cancelled = true;
						},
						start(controller) {
							controller.enqueue(chunk);
							controller.enqueue(chunk);
						},
					}),
					{ status: 200 },
				),
		);
		const client = createListmonkRuntimeClient({
			baseUrl: "https://mail.example.com",
			username: "runtime",
			accessToken: "test-token",
			fetch,
		});

		const error = await sendExternalTransactionalEmail({
			client,
			recipient: "private@example.com",
			templateId: 42,
		}).catch((cause: unknown) => cause);

		expect(error).toMatchObject({
			code: "request_failed",
			reason: "response_parse_failed",
			status: 200,
		});
		expect(cancelled).toBe(true);
	});

	test("distinguishes an abort without retrying the request", async () => {
		const fetch = mock(async () => Response.json({ data: true }));
		const client = createListmonkRuntimeClient({
			baseUrl: "https://mail.example.com",
			username: "runtime",
			accessToken: "test-token",
			fetch,
		});
		const controller = new AbortController();
		controller.abort();

		await expect(
			sendExternalTransactionalEmail({
				client,
				templateId: 42,
				recipient: "trainer@example.com",
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ code: "aborted", reason: "aborted" });
		expect(fetch).not.toHaveBeenCalled();
	});

	test("preserves an abort that happens during fetch", async () => {
		const controller = new AbortController();
		const fetch = mock(async () => {
			controller.abort();
			throw new DOMException("request aborted", "AbortError");
		});
		const client = createListmonkRuntimeClient({
			baseUrl: "https://mail.example.com",
			username: "runtime",
			accessToken: "test-token",
			fetch,
		});

		await expect(
			sendExternalTransactionalEmail({
				client,
				templateId: 42,
				recipient: "trainer@example.com",
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ code: "aborted", reason: "aborted" });
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	test("classifies a caller TimeoutError signal as an abort", async () => {
		const controller = new AbortController();
		const callerTimeout = new DOMException("caller timeout", "TimeoutError");
		const fetch = mock(async () => {
			controller.abort(callerTimeout);
			throw callerTimeout;
		});
		const client = createListmonkRuntimeClient({
			baseUrl: "https://mail.example.com",
			username: "runtime",
			accessToken: "test-token",
			fetch,
		});

		await expect(
			sendExternalTransactionalEmail({
				client,
				recipient: "trainer@example.com",
				signal: controller.signal,
				templateId: 42,
			}),
		).rejects.toMatchObject({ code: "aborted", reason: "aborted" });
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	test("bounds an Error-like rejection with a throwing name accessor", async () => {
		const unsafeError = Object.defineProperty({}, "name", {
			get() {
				throw new Error("private accessor detail");
			},
		});
		const fetch = mock(async () => {
			throw unsafeError;
		});
		const client = createListmonkRuntimeClient({
			baseUrl: "https://mail.example.com",
			username: "runtime",
			accessToken: "test-token",
			fetch,
		});

		const error = await sendExternalTransactionalEmail({
			client,
			recipient: "private@example.com",
			templateId: 42,
		}).catch((cause: unknown) => cause);

		expect(error).toBeInstanceOf(ListmonkRuntimeError);
		expect((error as ListmonkRuntimeError).code).toBe("request_failed");
		expect((error as ListmonkRuntimeError).reason).toBe("network_error");
		expect(String(error)).not.toContain("private accessor detail");
	});

	test("does not let signal cleanup replace an accepted send", async () => {
		const fetch = mock(async () => Response.json({ data: true }));
		const client = createListmonkRuntimeClient({
			baseUrl: "https://mail.example.com",
			username: "runtime",
			accessToken: "test-token",
			fetch,
		});
		const signal = {
			aborted: false,
			addEventListener() {},
			removeEventListener() {
				throw new Error("private cleanup error");
			},
		} as unknown as AbortSignal;

		await expect(
			sendExternalTransactionalEmail({
				client,
				recipient: "trainer@example.com",
				signal,
				templateId: 42,
			}),
		).resolves.toEqual({ sent: true, status: 200 });
	});

	test("cleans up when body serialization fails synchronously", async () => {
		const fetch = mock(async () => Response.json({ data: true }));
		const client = createListmonkRuntimeClient({
			baseUrl: "https://mail.example.com",
			username: "runtime",
			accessToken: "test-token",
			fetch,
		});
		const controller = new AbortController();
		const removeListener = spyOn(controller.signal, "removeEventListener");

		await expect(
			sendExternalTransactionalEmail({
				client,
				templateId: 42,
				recipient: "trainer@example.com",
				data: { payload: "x".repeat(65_500) },
				signal: controller.signal,
			}),
		).rejects.toMatchObject({
			code: "invalid_message",
		});
		expect(fetch).not.toHaveBeenCalled();
		expect(removeListener).toHaveBeenCalledTimes(1);
	});

	test("bounds requests with a defaultable timeout", async () => {
		const fetch = mock(
			async (request: Request) =>
				new Promise<Response>((_resolve, reject) => {
					request.signal.addEventListener(
						"abort",
						() => reject(request.signal.reason),
						{ once: true },
					);
				}),
		);
		const client = createListmonkRuntimeClient({
			baseUrl: "https://mail.example.com",
			username: "runtime",
			accessToken: "test-token",
			fetch,
		});

		await expect(
			sendExternalTransactionalEmail({
				client,
				templateId: 42,
				recipient: "trainer@example.com",
				timeoutMs: 20,
			}),
		).rejects.toMatchObject({ code: "timed_out", reason: "timed_out" });
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	test("preserves a runtime timeout while reading a successful body", async () => {
		const fetch = mock(
			async (request: Request) =>
				new Response(
					new ReadableStream({
						start(controller) {
							request.signal.addEventListener(
								"abort",
								() => controller.error(request.signal.reason),
								{ once: true },
							);
						},
					}),
					{ status: 200 },
				),
		);
		const client = createListmonkRuntimeClient({
			baseUrl: "https://mail.example.com",
			username: "runtime",
			accessToken: "test-token",
			fetch,
		});

		await expect(
			sendExternalTransactionalEmail({
				client,
				recipient: "trainer@example.com",
				templateId: 42,
				timeoutMs: 20,
			}),
		).rejects.toMatchObject({ code: "timed_out", reason: "timed_out" });
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	test("cancels a stalled successful body when its source ignores abort", async () => {
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({
			cancel() {
				cancelled = true;
			},
		});
		const fetch = mock(
			async () =>
				new Response(body, {
					status: 200,
				}),
		);
		const client = createListmonkRuntimeClient({
			baseUrl: "https://mail.example.com",
			username: "runtime",
			accessToken: "test-token",
			fetch,
		});

		await expect(
			sendExternalTransactionalEmail({
				client,
				recipient: "trainer@example.com",
				templateId: 42,
				timeoutMs: 20,
			}),
		).rejects.toMatchObject({ code: "timed_out", reason: "timed_out" });
		await Promise.resolve();
		expect(cancelled).toBe(true);
		expect(body.locked).toBe(false);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	test("enforces the runtime timeout when Fetch ignores its signal", async () => {
		const fetch = mock(async () => {
			await new Promise((resolve) => setTimeout(resolve, 30));
			return Response.json({ data: true });
		});
		const client = createListmonkRuntimeClient({
			baseUrl: "https://mail.example.com",
			username: "runtime",
			accessToken: "test-token",
			fetch,
		});

		await expect(
			sendExternalTransactionalEmail({
				client,
				recipient: "trainer@example.com",
				templateId: 42,
				timeoutMs: 20,
			}),
		).rejects.toMatchObject({ code: "timed_out", reason: "timed_out" });
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	test(
		"returns when Fetch ignores its signal and never settles",
		async () => {
			const fetch = mock(
				async () => new Promise<Response>(() => undefined),
			);
			const client = createListmonkRuntimeClient({
				baseUrl: "https://mail.example.com",
				username: "runtime",
				accessToken: "test-token",
				fetch,
			});

			await expect(
				sendExternalTransactionalEmail({
					client,
					recipient: "trainer@example.com",
					templateId: 42,
					timeoutMs: 20,
				}),
			).rejects.toMatchObject({ code: "timed_out", reason: "timed_out" });
			expect(fetch).toHaveBeenCalledTimes(1);
		},
		500,
	);

	test("treats a missing acknowledgement as a request failure", async () => {
		const fetch = mock(async () => Response.json({}));
		const client = createListmonkRuntimeClient({
			baseUrl: "https://mail.example.com",
			username: "runtime",
			accessToken: "test-token",
			fetch,
		});

		await expect(
			sendExternalTransactionalEmail({
				client,
				templateId: 42,
				recipient: "trainer@example.com",
			}),
		).rejects.toMatchObject({
			code: "request_failed",
			reason: "invalid_acknowledgement",
			status: 200,
		});
	});

	test("requires an explicit positive acknowledgement", async () => {
		const fetch = mock(async () => Response.json({ data: false }));
		const client = createListmonkRuntimeClient({
			baseUrl: "https://mail.example.com",
			username: "runtime",
			accessToken: "test-token",
			fetch,
		});

		await expect(
			sendExternalTransactionalEmail({
				client,
				templateId: 42,
				recipient: "trainer@example.com",
			}),
		).rejects.toMatchObject({
			code: "delivery_rejected",
			reason: "negative_acknowledgement",
			status: 200,
		});
	});
});
