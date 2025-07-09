import { describe, expect, test } from "bun:test";
import { transformResponse } from "../index";

describe("Response Transform", () => {
	describe("transformResponse", () => {
		test("should handle simple data structure", async () => {
			const response = {
				data: { name: "Test List", id: 1 },
				message: "Success",
			};

			const result = await transformResponse(response);
			expect(result).toEqual({
				data: { name: "Test List", id: 1 },
				message: "Success",
			});
		});

		test("should flatten nested data.data structure", async () => {
			const response = {
				data: {
					data: { name: "Test List", id: 1 },
					message: "Success",
				},
			};

			const result = await transformResponse(response);
			expect(result).toEqual({
				data: { name: "Test List", id: 1 },
				message: "Success",
			});
		});

		test("should recursively flatten deeply nested data structures", async () => {
			const response = {
				data: {
					data: {
						data: {
							data: { name: "Deep Test", id: 1 },
							message: "Inner message",
						},
						extraProp: "preserved",
					},
					message: "Middle message",
				},
				topMessage: "Top message",
			};

			const result = await transformResponse(response);
			expect(result).toEqual({
				data: { name: "Deep Test", id: 1 },
				message: "Inner message",
				extraProp: "preserved",
				topMessage: "Top message",
			});
		});

		test("should handle non-object responses", async () => {
			const primitives = [null, undefined, "string", 123, true, []];

			for (const primitive of primitives) {
				const result = await transformResponse(primitive);
				expect(result).toBe(primitive);
			}
		});

		test("should preserve other properties while flattening", async () => {
			const response = {
				data: {
					data: { items: ["a", "b", "c"] },
					message: "Nested message",
					timestamp: "2023-01-01",
				},
				status: "success",
				meta: { total: 3 },
			};

			const result = await transformResponse(response);
			expect(result).toEqual({
				data: { items: ["a", "b", "c"] },
				message: "Nested message",
				timestamp: "2023-01-01",
				status: "success",
				meta: { total: 3 },
			});
		});

		test("should handle empty data object", async () => {
			const response = {
				data: { data: {} },
				message: "Empty data",
			};

			const result = await transformResponse(response);
			expect(result).toEqual({
				data: {},
				message: "Empty data",
			});
		});

		test("should handle missing data property", async () => {
			const response = {
				message: "No data property",
				items: ["a", "b", "c"],
			};

			const result = await transformResponse(response);
			expect(result).toEqual({
				message: "No data property",
				items: ["a", "b", "c"],
			});
		});

		test("should handle arrays", async () => {
			const response = [1, 2, 3];
			const result = await transformResponse(response);
			expect(result).toEqual([1, 2, 3]);
		});

		test("should handle complex nested structures with mixed types", async () => {
			const response = {
				data: {
					data: {
						users: [
							{ id: 1, name: "User 1" },
							{ id: 2, name: "User 2" }
						],
						pagination: {
							total: 2,
							page: 1,
							per_page: 10
						}
					},
					message: "Users retrieved successfully",
					metadata: {
						query_time: "0.05s",
						cache_hit: true
					}
				},
				status: 200,
				timestamp: "2023-01-01T00:00:00Z"
			};

			const result = await transformResponse(response);
			expect(result).toEqual({
				data: {
					users: [
						{ id: 1, name: "User 1" },
						{ id: 2, name: "User 2" }
					],
					pagination: {
						total: 2,
						page: 1,
						per_page: 10
					}
				},
				message: "Users retrieved successfully",
				metadata: {
					query_time: "0.05s",
					cache_hit: true
				},
				status: 200,
				timestamp: "2023-01-01T00:00:00Z"
			});
		});
	});
});
