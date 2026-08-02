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

async function requestRoleEndpoint<T>(
	options: RoleOperationOptions,
	requestOptions: {
		method: "GET" | "POST" | "PUT";
		id?: number;
		body?: UserRoleInput;
	},
): Promise<CrudResult<T>> {
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

	return (await transformResponse({
		data: payload,
		request,
		response,
	})) as FlattenedResponse<T>;
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
			const response = await requestRoleEndpoint<UserRole[]>(options, {
				method: "GET",
			});
			return normalizeListResult<UserRole>(response);
		},
		async create({ body }) {
			return requestRoleEndpoint<UserRole>(options, { method: "POST", body });
		},
		async update({ path, body }) {
			return requestRoleEndpoint<UserRole>(options, {
				method: "PUT",
				id: path.id,
				body,
			});
		},
	};
}
