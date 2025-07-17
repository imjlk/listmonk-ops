import type { CallToolRequest, CallToolResult } from "./mcp.js";
import type { ListmonkClient } from "@listmonk-ops/openapi";

// Common pagination parameters
export interface PaginationParams {
	page?: number;
	per_page?: number;
}

// Standard handler function signature
export type HandlerFunction = (
	request: CallToolRequest,
	client: ListmonkClient,
) => Promise<CallToolResult>;

// Common parameter validation patterns
export interface RequiredIdParam {
	id: string;
}

// Campaign status enum for type safety
export type CampaignStatus = "draft" | "scheduled" | "running" | "paused" | "finished" | "cancelled";

// List types for type safety
export type ListType = "public" | "private";
export type OptinType = "single" | "double";

// Common response handler for CrudResult types
export interface CrudResponse<T> {
	data?: T;
	error?: string;
}

// Helper type for API response validation
export function isCrudError<T>(response: CrudResponse<T>): response is { error: string } {
	return 'error' in response && response.error !== undefined;
}

// Common parameter types for create/update operations
export interface BaseCreateParams {
	name: string;
	description?: string;
	tags?: string[];
}

export interface BaseUpdateParams {
	id: string;
	name?: string;
	description?: string;
	tags?: string[];
}

// Email-related types
export interface EmailParams {
	from_email: string;
	subject: string;
	body: string;
	altbody?: string;
}

// Template-related types
export interface TemplateParams extends BaseCreateParams {
	body: string;
	type?: "campaign" | "tx";
	is_default?: boolean;
}

// List-related types
export interface ListCreateParams extends BaseCreateParams {
	type?: ListType;
	optin?: OptinType;
}

export interface ListUpdateParams extends BaseUpdateParams {
	type?: ListType;
	optin?: OptinType;
}

// Campaign-related types
export interface CampaignCreateParams extends EmailParams, BaseCreateParams {
	type?: "regular" | "optin";
	template_id: number;
	lists: number[];
	messenger?: string;
}

// Subscriber-related types
export interface SubscriberParams {
	email: string;
	name?: string;
	status?: "enabled" | "disabled" | "blocklisted";
	lists?: number[];
	preconfirm_subscriptions?: boolean;
	attribs?: Record<string, any>;
}

// Common query parameter types
export interface FilterParams {
	query?: string;
	list_id?: number;
	status?: string[];
	subscription_status?: string;
	order_by?: string;
	order?: "asc" | "desc";
}

// Bounce-related types
export interface BounceFilterParams extends PaginationParams {
	campaign_id?: number;
	subscriber_id?: number;
	source?: string;
}

// Media-related types
export interface MediaUploadParams {
	file: File | Buffer;
	filename: string;
}