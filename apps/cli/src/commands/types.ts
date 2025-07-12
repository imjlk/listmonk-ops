import type { AbTest, AbTestConfig, TestAnalysis } from "@listmonk-ops/abtest";
import type { Campaign, List } from "@listmonk-ops/openapi";

// Common types used across all command modules
export interface CommandContext {
	values: Record<string, unknown>;
}

// Domain-specific executor interfaces
export interface AbTestExecutors {
	createAbTest(config: AbTestConfig): Promise<AbTest>;
	analyzeAbTest(testId: string): Promise<TestAnalysis>;
}

export interface CampaignExecutors {
	listCampaigns(): Promise<Campaign[]>;
	getCampaign(id: string): Promise<Campaign>;
}

export interface ListExecutors {
	listSubscriberLists(): Promise<List[]>;
	getSubscriberList(id: string): Promise<List>;
}

// Combined interface for backward compatibility
export interface CommandExecutors extends AbTestExecutors, CampaignExecutors, ListExecutors { }
