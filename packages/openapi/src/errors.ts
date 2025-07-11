/**
 * Base error class for all Listmonk API errors
 */
export class ListmonkError extends Error {
	constructor(
		message: string,
		public statusCode?: number,
		public response?: unknown,
		public originalError?: Error,
	) {
		super(message);
		this.name = "ListmonkError";

		// Maintain proper stack trace for where our error was thrown
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, ListmonkError);
		}
	}
}

/**
 * Error thrown when authentication fails
 */
export class AuthenticationError extends ListmonkError {
	constructor(message = "Authentication failed", response?: unknown) {
		super(message, 401, response);
		this.name = "AuthenticationError";
	}
}

/**
 * Error thrown when request validation fails
 */
export class ValidationError extends ListmonkError {
	constructor(
		message = "Validation failed",
		public errors?: Record<string, string[]>,
		response?: unknown,
	) {
		super(message, 400, response);
		this.name = "ValidationError";
	}
}

/**
 * Error thrown when a resource is not found
 */
export class NotFoundError extends ListmonkError {
	constructor(message = "Resource not found", response?: unknown) {
		super(message, 404, response);
		this.name = "NotFoundError";
	}
}

/**
 * Error thrown when rate limit is exceeded
 */
export class RateLimitError extends ListmonkError {
	constructor(message = "Rate limit exceeded", response?: unknown) {
		super(message, 429, response);
		this.name = "RateLimitError";
	}
}

/**
 * Error thrown when server returns 5xx status codes
 */
export class ServerError extends ListmonkError {
	constructor(
		message = "Internal server error",
		statusCode = 500,
		response?: unknown,
	) {
		super(message, statusCode, response);
		this.name = "ServerError";
	}
}

/**
 * Factory function to create appropriate error based on status code
 */
export const createErrorFromResponse = (
	response: Response,
	message?: string,
	responseData?: unknown,
): ListmonkError => {
	const status = response.status;
	const defaultMessage = message || `HTTP ${status}: ${response.statusText}`;

	switch (status) {
		case 401:
			return new AuthenticationError(defaultMessage, responseData);
		case 400:
			return new ValidationError(defaultMessage, undefined, responseData);
		case 404:
			return new NotFoundError(defaultMessage, responseData);
		case 429:
			return new RateLimitError(defaultMessage, responseData);
		default:
			if (status >= 500) {
				return new ServerError(defaultMessage, status, responseData);
			}
			return new ListmonkError(defaultMessage, status, responseData);
	}
};

/**
 * Type guard to check if an error is a ListmonkError
 */
export const isListmonkError = (error: unknown): error is ListmonkError => {
	return error instanceof ListmonkError;
};
