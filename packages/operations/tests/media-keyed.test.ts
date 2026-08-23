import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import { invokeUploadMediaOperation } from "../src";
import { createInMemoryResourceCreateStore } from "./helpers/resource-create-store.js";

type MediaClient = Pick<ListmonkClient, "media">;

const base64 = Buffer.from("hello media").toString("base64");

function context(media: Partial<MediaClient["media"]>) {
	return { client: { media } as MediaClient };
}

describe("media upload operations", () => {
	test("returns the created envelope for an unkeyed upload", async () => {
		const upload = mock(async () => ({
			data: { id: 5, filename: "hello.txt", uuid: "uuid-5" },
		})) as unknown as MediaClient["media"]["upload"];

		const output = await invokeUploadMediaOperation(context({ upload }), {
			base64,
			filename: "hello.txt",
		});

		expect(output).toMatchObject({
			created: true,
			media: { id: 5, filename: "hello.txt" },
		});
	});

	test("replays a keyed upload and treats equivalent base64 encodings as identical", async () => {
		const { store, records } = createInMemoryResourceCreateStore();
		const upload = mock(async () => ({
			data: { id: 5, filename: "hello.txt", uuid: "uuid-5" },
		})) as unknown as MediaClient["media"]["upload"];
		const getById = mock(async () => ({
			data: { id: 5, filename: "hello.txt" },
		})) as unknown as MediaClient["media"]["getById"];
		const ctx = {
			client: { media: { upload, getById } } as unknown as MediaClient,
			createIdempotencyStore: store,
			hashCreatePayload: (value: string) => `hash:${value}`,
			target: { baseUrl: "https://listmonk.example", username: "admin" },
		};

		const first = await invokeUploadMediaOperation(ctx, {
			base64,
			filename: "hello.txt",
			idempotency_key: "media-key-1",
		});
		expect(first.created).toBe(true);
		expect(first.media).toMatchObject({ id: 5 });
		expect(upload).toHaveBeenCalledTimes(1);

		// Same bytes re-encoded as URL-safe base64 without padding: the
		// canonical payload hashes identically, so the retry replays.
		const urlSafe = base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
		const retried = await invokeUploadMediaOperation(ctx, {
			base64: urlSafe,
			filename: "hello.txt",
			idempotency_key: "media-key-1",
		});
		expect(retried.created).toBe(false);
		expect(retried.media).toMatchObject({ id: 5 });
		expect(upload).toHaveBeenCalledTimes(1);
		expect(records.get("media-key-1")).toMatchObject({
			status: "created",
			resourceId: "5",
		});

		// A different payload under the same key conflicts.
		await expect(
			invokeUploadMediaOperation(ctx, {
				base64: Buffer.from("other").toString("base64"),
				filename: "hello.txt",
				idempotency_key: "media-key-1",
			}),
		).rejects.toThrow(/different create request/);

		// A key without a store is rejected as unsupported.
		await expect(
			invokeUploadMediaOperation(
				{ client: ctx.client },
				{ base64, filename: "hello.txt", idempotency_key: "media-key-2" },
			),
		).rejects.toThrow(/idempotency store/);

		// A key without a resolved target cannot namespace the record.
		await expect(
			invokeUploadMediaOperation(
				{ ...ctx, target: undefined },
				{ base64, filename: "hello.txt", idempotency_key: "media-key-3" },
			),
		).rejects.toThrow(/resolved Listmonk target/);
	});

	test("treats encodings differing only in pad bits as identical", async () => {
		const { store } = createInMemoryResourceCreateStore();
		const upload = mock(async () => ({
			data: { id: 7, filename: "byte.png", uuid: "uuid-7" },
		})) as unknown as MediaClient["media"]["upload"];
		const getById = mock(async () => ({
			data: { id: 7, filename: "byte.png" },
		})) as unknown as MediaClient["media"]["getById"];
		const ctx = {
			client: { media: { upload, getById } } as unknown as MediaClient,
			createIdempotencyStore: store,
			hashCreatePayload: (value: string) => `hash:${value}`,
			target: { baseUrl: "https://listmonk.example", username: "admin" },
		};

		// Both decode to the single byte 0x61; only the pad bits differ.
		const first = await invokeUploadMediaOperation(ctx, {
			base64: "YQ==",
			filename: "byte.png",
			content_type: "image/png",
			idempotency_key: "media-pad-bits",
		});
		expect(first.created).toBe(true);

		const retried = await invokeUploadMediaOperation(ctx, {
			base64: "YR==",
			filename: "byte.png",
			content_type: "image/png",
			idempotency_key: "media-pad-bits",
		});
		expect(retried.created).toBe(false);
		expect(retried.media).toMatchObject({ id: 7 });
		expect(upload).toHaveBeenCalledTimes(1);
	});

	test("binds an id-less uploaded record through its immutable uuid", async () => {
		const { store, records } = createInMemoryResourceCreateStore();
		const upload = mock(async () => ({
			data: { filename: "hello.txt", uuid: "uuid-new" },
		})) as unknown as MediaClient["media"]["upload"];
		const list = mock(async () => ({
			data: {
				results: [
					{ id: 4, filename: "hello.txt", uuid: "uuid-old" },
					{ id: 5, filename: "hello.txt", uuid: "uuid-new" },
				],
			},
		})) as unknown as MediaClient["media"]["list"];
		const ctx = {
			client: { media: { upload, list } } as unknown as MediaClient,
			createIdempotencyStore: store,
			hashCreatePayload: (value: string) => `hash:${value}`,
			target: { baseUrl: "https://listmonk.example", username: "admin" },
		};

		const output = await invokeUploadMediaOperation(ctx, {
			base64,
			filename: "hello.txt",
			idempotency_key: "media-uuid",
		});

		expect(output).toMatchObject({ created: true, media: { id: 5 } });
		expect(records.get("media-uuid")).toMatchObject({
			status: "created",
			resourceId: "5",
		});
	});

	test("burns the key when an accepted upload cannot be correlated", async () => {
		const { store, records } = createInMemoryResourceCreateStore();
		const upload = mock(async () => ({
			data: { filename: "hello.txt" },
		})) as unknown as MediaClient["media"]["upload"];
		const list = mock(async () => ({
			data: { results: [{ id: 4, filename: "hello.txt" }] },
		})) as unknown as MediaClient["media"]["list"];
		const ctx = {
			client: { media: { upload, list } } as unknown as MediaClient,
			createIdempotencyStore: store,
			hashCreatePayload: (value: string) => `hash:${value}`,
			target: { baseUrl: "https://listmonk.example", username: "admin" },
		};

		await expect(
			invokeUploadMediaOperation(ctx, {
				base64,
				filename: "hello.txt",
				idempotency_key: "media-unresolved",
			}),
		).rejects.toThrow(/could not be correlated/);
		expect(records.get("media-unresolved")?.status).toBe("unknown");
		// A same-named media file is never adopted as proof.
		expect(list).not.toHaveBeenCalled();
	});
});
