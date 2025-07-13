import { z } from "zod";

// Common schemas
export const IdSchema = z.union([z.string(), z.number()]).transform(String);
export const PaginationSchema = z.object({
	page: z.number().optional().default(1),
	per_page: z.number().optional().default(20),
});

// List schemas
export const ListTypeSchema = z.enum(["public", "private"]);
export const ListOptinSchema = z.enum(["single", "double"]);

export const ListSchema = z.object({
	id: z.number(),
	uuid: z.string(),
	name: z.string(),
	type: ListTypeSchema,
	optin: ListOptinSchema,
	tags: z.array(z.string()),
	description: z.string().optional(),
	subscriber_count: z.number().optional(),
	created_at: z.string(),
	updated_at: z.string(),
});

export const CreateListSchema = z.object({
	name: z.string().min(1),
	type: ListTypeSchema.default("private"),
	optin: ListOptinSchema.default("single"),
	tags: z.array(z.string()).optional(),
	description: z.string().optional(),
});

export const UpdateListSchema = CreateListSchema.partial();

// Subscriber schemas
export const SubscriberStatusSchema = z.enum([
	"enabled",
	"disabled",
	"blocklisted",
]);

export const SubscriberSchema = z.object({
	id: z.number(),
	uuid: z.string(),
	email: z.string().email(),
	name: z.string(),
	status: SubscriberStatusSchema,
	lists: z.array(ListSchema),
	attribs: z.record(z.string(), z.unknown()).optional(),
	created_at: z.string(),
	updated_at: z.string(),
});

export const CreateSubscriberSchema = z.object({
	email: z.string().email(),
	name: z.string(),
	status: SubscriberStatusSchema.default("enabled"),
	lists: z.array(z.number()).optional(),
	attribs: z.record(z.string(), z.unknown()).optional(),
});

export const UpdateSubscriberSchema = CreateSubscriberSchema.partial();

// Campaign schemas
export const CampaignStatusSchema = z.enum([
	"draft",
	"scheduled",
	"running",
	"paused",
	"finished",
	"cancelled",
]);

export const CampaignTypeSchema = z.enum(["regular", "optin"]);

export const CampaignSchema = z.object({
	id: z.number(),
	uuid: z.string(),
	name: z.string(),
	subject: z.string(),
	from_email: z.string().email(),
	body: z.string(),
	altbody: z.string().optional(),
	status: CampaignStatusSchema,
	type: CampaignTypeSchema,
	tags: z.array(z.string()),
	template_id: z.number(),
	messenger: z.string(),
	lists: z.array(ListSchema),
	started_at: z.string().optional(),
	to_send: z.number().optional(),
	sent: z.number().optional(),
	created_at: z.string(),
	updated_at: z.string(),
});

export const CreateCampaignSchema = z.object({
	name: z.string().min(1),
	subject: z.string().min(1),
	from_email: z.string().email(),
	body: z.string(),
	altbody: z.string().optional(),
	type: CampaignTypeSchema.default("regular"),
	tags: z.array(z.string()).optional(),
	template_id: z.number(),
	messenger: z.string().default("email"),
	lists: z.array(z.number()),
});

export const UpdateCampaignSchema = CreateCampaignSchema.partial();

// Template schemas
export const TemplateTypeSchema = z.enum(["campaign", "tx"]);

export const TemplateSchema = z.object({
	id: z.number(),
	name: z.string(),
	type: TemplateTypeSchema,
	subject: z.string().optional(),
	body: z.string(),
	is_default: z.boolean(),
	created_at: z.string(),
	updated_at: z.string(),
});

// Media schemas
export const MediaSchema = z.object({
	id: z.number(),
	uuid: z.string(),
	filename: z.string(),
	thumb: z.string(),
	url: z.string(),
	created_at: z.string(),
});

// Bounce schemas
export const BounceTypeSchema = z.enum(["soft", "hard", "complaint"]);

export const BounceSchema = z.object({
	id: z.number(),
	type: BounceTypeSchema,
	source: z.string(),
	meta: z.record(z.string(), z.unknown()),
	subscriber: SubscriberSchema,
	campaign: CampaignSchema.optional(),
	created_at: z.string(),
});

// API Response schemas
export const ApiResponseSchema = z.object({
	data: z.unknown(),
});

export const ApiErrorSchema = z.object({
	message: z.string(),
	type: z.string().optional(),
});

// Type exports
export type List = z.infer<typeof ListSchema>;
export type CreateList = z.infer<typeof CreateListSchema>;
export type UpdateList = z.infer<typeof UpdateListSchema>;
export type Subscriber = z.infer<typeof SubscriberSchema>;
export type CreateSubscriber = z.infer<typeof CreateSubscriberSchema>;
export type UpdateSubscriber = z.infer<typeof UpdateSubscriberSchema>;
export type Campaign = z.infer<typeof CampaignSchema>;
export type CreateCampaign = z.infer<typeof CreateCampaignSchema>;
export type UpdateCampaign = z.infer<typeof UpdateCampaignSchema>;
export type Template = z.infer<typeof TemplateSchema>;
export type Media = z.infer<typeof MediaSchema>;
export type Bounce = z.infer<typeof BounceSchema>;
export type ApiResponse = z.infer<typeof ApiResponseSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
