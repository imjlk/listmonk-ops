import type {
	EnhancedListmonkClient,
	UserRole,
	UserRoleInput,
} from "./contracts";
import type { CrudResult, FlattenedResponse, ListResult } from "./response";
import { normalizeListResult, transformResponse } from "./response";
import type { FetchFn } from "./transport";

interface RoleOperationOptions {
	baseUrl: string;
	headers?: Record<string, string>;
	resilientFetch: FetchFn;
}

function createUserRolesUrl(baseUrl: string, id?: number): string {
	const url = new URL(baseUrl);
	const basePath = url.pathname.replace(/\/+$/, "");
	url.pathname = `${basePath}/roles/users${id === undefined ? "" : `/${id}`}`;
	url.search = "";
	url.hash = "";
	return url.toString();
}

async function parseResponsePayload(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBlankFreeStringArray(value: unknown): value is string[] {
	// Listmonk permits an empty permission set for a no-access role. Reject
	// blank entries without requiring the array itself to be non-empty.
	return (
		Array.isArray(value) &&
		value.every((entry) => typeof entry === "string" && entry.trim().length > 0)
	);
}

function hasValidNameAndPermissions(
	value: Record<string, unknown>,
): boolean {
	return (
		typeof value.name === "string" &&
		value.name.trim().length > 0 &&
		isBlankFreeStringArray(value.permissions)
	);
}

function isUserRoleInput(value: unknown): value is UserRoleInput {
	return isRecord(value) && hasValidNameAndPermissions(value);
}

function isUserRole(value: unknown): value is UserRole {
	return (
		isRecord(value) &&
		typeof value.id === "number" &&
		Number.isSafeInteger(value.id) &&
		value.id > 0 &&
		hasValidNameAndPermissions(value) &&
		(value.type === undefined || typeof value.type === "string") &&
		(value.created_at === undefined || typeof value.created_at === "string") &&
		(value.updated_at === undefined || typeof value.updated_at === "string")
	);
}

function requestInputError(requestOptions: {
	id?: number;
	body?: UserRoleInput;
}): TypeError | undefined {
	if (
		requestOptions.id !== undefined &&
		(!Number.isSafeInteger(requestOptions.id) || requestOptions.id <= 0)
	) {
		return new TypeError(
			"Listmonk user role ID must be a positive safe integer",
		);
	}
	if (
		requestOptions.body !== undefined &&
		!isUserRoleInput(requestOptions.body)
	) {
		return new TypeError(
			"Listmonk user role body requires a non-empty name and string permissions",
		);
	}
	return undefined;
}

async function requestRoleEndpoint<T>(
	options: RoleOperationOptions,
	requestOptions: {
		method: "GET" | "POST" | "PUT";
		id?: number;
		body?: UserRoleInput;
	},
	validateData: (value: unknown) => value is T,
): Promise<CrudResult<T>> {
	const inputError = requestInputError(requestOptions);
	if (inputError !== undefined) return { error: inputError };

	const headers = new Headers(options.headers);
	headers.set("Accept", "application/json");
	if (requestOptions.body !== undefined) {
		headers.set("Content-Type", "application/json");
	}
	const request = new Request(
		createUserRolesUrl(options.baseUrl, requestOptions.id),
		{
			method: requestOptions.method,
			headers,
			body:
				requestOptions.body === undefined
					? undefined
					: JSON.stringify(requestOptions.body),
		},
	);
	let response: Response;
	try {
		response = await options.resilientFetch(request);
	} catch (error) {
		// Match the generated client's default non-throwing transport contract.
		return { error, request };
	}
	const payload = await parseResponsePayload(response);
	if (!response.ok) {
		return {
			error:
				payload ??
				new Error(
					`Listmonk user role request failed with status ${response.status}`,
				),
			request,
			response,
		};
	}

	const transformed = (await transformResponse({
		data: payload,
		request,
		response,
	})) as FlattenedResponse<unknown>;
	if (!validateData(transformed.data)) {
		return {
			error: new TypeError("Listmonk returned a malformed user role response"),
			request,
			response,
		};
	}
	return transformed as FlattenedResponse<T>;
}

/**
 * Handwritten facade for Listmonk 6.2 user-role endpoints, which are not
 * represented in the upstream OpenAPI document used to generate the SDK.
 */
export function createUserRoleOperations(
	options: RoleOperationOptions,
): EnhancedListmonkClient["userRole"] {
	return {
		async list(): Promise<ListResult<UserRole>> {
			const response = await requestRoleEndpoint<UserRole[]>(
				options,
				{ method: "GET" },
				(value): value is UserRole[] =>
					Array.isArray(value) && value.every(isUserRole),
			);
			return normalizeListResult<UserRole>(response);
		},
		async create({ body }) {
			return requestRoleEndpoint<UserRole>(
				options,
				{ method: "POST", body },
				isUserRole,
			);
		},
		async update({ path, body }) {
			return requestRoleEndpoint<UserRole>(
				options,
				{
					method: "PUT",
					id: path.id,
					body,
				},
				isUserRole,
			);
		},
	};
}
