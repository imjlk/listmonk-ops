import { describe, expect, test } from "bun:test";
import {
	AuthenticationError,
	createErrorFromResponse,
	isListmonkError,
	ListmonkError,
	NotFoundError,
	RateLimitError,
	ServerError,
	ValidationError,
} from "../src/errors";

describe("Error Classes", () => {
	describe("ListmonkError", () => {
		test("should create base error with message", () => {
			const error = new ListmonkError("Test error");

			expect(error.name).toBe("ListmonkError");
			expect(error.message).toBe("Test error");
			expect(error.statusCode).toBeUndefined();
			expect(error.response).toBeUndefined();
			expect(error.originalError).toBeUndefined();
		});

		test("should create error with all properties", () => {
			const response = { error: "test" };
			const originalError = new Error("Original");
			const error = new ListmonkError(
				"Test error",
				500,
				response,
				originalError,
			);

			expect(error.name).toBe("ListmonkError");
			expect(error.message).toBe("Test error");
			expect(error.statusCode).toBe(500);
			expect(error.response).toBe(response);
			expect(error.originalError).toBe(originalError);
		});

		test("should be instanceof Error", () => {
			const error = new ListmonkError("Test error");
			expect(error instanceof Error).toBe(true);
			expect(error instanceof ListmonkError).toBe(true);
		});
	});

	describe("AuthenticationError", () => {
		test("should create with default message", () => {
			const error = new AuthenticationError();

			expect(error.name).toBe("AuthenticationError");
			expect(error.message).toBe("Authentication failed");
			expect(error.statusCode).toBe(401);
		});

		test("should create with custom message and response", () => {
			const response = { error: "Invalid token" };
			const error = new AuthenticationError("Custom auth error", response);

			expect(error.name).toBe("AuthenticationError");
			expect(error.message).toBe("Custom auth error");
			expect(error.statusCode).toBe(401);
			expect(error.response).toBe(response);
		});

		test("should be instanceof ListmonkError", () => {
			const error = new AuthenticationError();
			expect(error instanceof ListmonkError).toBe(true);
			expect(error instanceof AuthenticationError).toBe(true);
		});
	});

	describe("ValidationError", () => {
		test("should create with default message", () => {
			const error = new ValidationError();

			expect(error.name).toBe("ValidationError");
			expect(error.message).toBe("Validation failed");
			expect(error.statusCode).toBe(400);
			expect(error.errors).toBeUndefined();
		});

		test("should create with validation errors", () => {
			const errors = {
				email: ["Invalid email format"],
				name: ["Required field"],
			};
			const response = { validation_errors: errors };
			const error = new ValidationError("Validation failed", errors, response);

			expect(error.name).toBe("ValidationError");
			expect(error.message).toBe("Validation failed");
			expect(error.statusCode).toBe(400);
			expect(error.errors).toBe(errors);
			expect(error.response).toBe(response);
		});
	});

	describe("NotFoundError", () => {
		test("should create with default message", () => {
			const error = new NotFoundError();

			expect(error.name).toBe("NotFoundError");
			expect(error.message).toBe("Resource not found");
			expect(error.statusCode).toBe(404);
		});
	});

	describe("RateLimitError", () => {
		test("should create with default message", () => {
			const error = new RateLimitError();

			expect(error.name).toBe("RateLimitError");
			expect(error.message).toBe("Rate limit exceeded");
			expect(error.statusCode).toBe(429);
		});
	});

	describe("ServerError", () => {
		test("should create with default message and status", () => {
			const error = new ServerError();

			expect(error.name).toBe("ServerError");
			expect(error.message).toBe("Internal server error");
			expect(error.statusCode).toBe(500);
		});

		test("should create with custom status code", () => {
			const error = new ServerError("Bad gateway", 502);

			expect(error.name).toBe("ServerError");
			expect(error.message).toBe("Bad gateway");
			expect(error.statusCode).toBe(502);
		});
	});

	describe("createErrorFromResponse", () => {
		const createMockResponse = (
			status: number,
			statusText: string,
		): Response => {
			return {
				status,
				statusText,
			} as Response;
		};

		test("should create AuthenticationError for 401", () => {
			const response = createMockResponse(401, "Unauthorized");
			const error = createErrorFromResponse(response);

			expect(error instanceof AuthenticationError).toBe(true);
			expect(error.message).toBe("HTTP 401: Unauthorized");
			expect(error.statusCode).toBe(401);
		});

		test("should create ValidationError for 400", () => {
			const response = createMockResponse(400, "Bad Request");
			const error = createErrorFromResponse(response);

			expect(error instanceof ValidationError).toBe(true);
			expect(error.message).toBe("HTTP 400: Bad Request");
			expect(error.statusCode).toBe(400);
		});

		test("should create NotFoundError for 404", () => {
			const response = createMockResponse(404, "Not Found");
			const error = createErrorFromResponse(response);

			expect(error instanceof NotFoundError).toBe(true);
			expect(error.message).toBe("HTTP 404: Not Found");
			expect(error.statusCode).toBe(404);
		});

		test("should create RateLimitError for 429", () => {
			const response = createMockResponse(429, "Too Many Requests");
			const error = createErrorFromResponse(response);

			expect(error instanceof RateLimitError).toBe(true);
			expect(error.message).toBe("HTTP 429: Too Many Requests");
			expect(error.statusCode).toBe(429);
		});

		test("should create ServerError for 5xx codes", () => {
			const response500 = createMockResponse(500, "Internal Server Error");
			const error500 = createErrorFromResponse(response500);

			expect(error500 instanceof ServerError).toBe(true);
			expect(error500.statusCode).toBe(500);

			const response502 = createMockResponse(502, "Bad Gateway");
			const error502 = createErrorFromResponse(response502);

			expect(error502 instanceof ServerError).toBe(true);
			expect(error502.statusCode).toBe(502);
		});

		test("should create generic ListmonkError for other status codes", () => {
			const response = createMockResponse(418, "I'm a teapot");
			const error = createErrorFromResponse(response);

			expect(error instanceof ListmonkError).toBe(true);
			expect(error instanceof AuthenticationError).toBe(false);
			expect(error.statusCode).toBe(418);
		});

		test("should use custom message when provided", () => {
			const response = createMockResponse(500, "Internal Server Error");
			const error = createErrorFromResponse(response, "Custom error message");

			expect(error.message).toBe("Custom error message");
		});

		test("should include response data", () => {
			const response = createMockResponse(400, "Bad Request");
			const responseData = { error: "Invalid input" };
			const error = createErrorFromResponse(response, undefined, responseData);

			expect(error.response).toBe(responseData);
		});
	});

	describe("isListmonkError", () => {
		test("should return true for ListmonkError instances", () => {
			const baseError = new ListmonkError("Test");
			const authError = new AuthenticationError();
			const validationError = new ValidationError();

			expect(isListmonkError(baseError)).toBe(true);
			expect(isListmonkError(authError)).toBe(true);
			expect(isListmonkError(validationError)).toBe(true);
		});

		test("should return false for non-ListmonkError instances", () => {
			const error = new Error("Regular error");
			const string = "error string";
			const number = 404;
			const object = { error: "object error" };

			expect(isListmonkError(error)).toBe(false);
			expect(isListmonkError(string)).toBe(false);
			expect(isListmonkError(number)).toBe(false);
			expect(isListmonkError(object)).toBe(false);
			expect(isListmonkError(null)).toBe(false);
			expect(isListmonkError(undefined)).toBe(false);
		});
	});
});
