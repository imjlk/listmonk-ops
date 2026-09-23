import { expect, test } from "bun:test";
import type { ListmonkConfigurationSummary } from "@listmonk-ops/common";
import {
	getControlConfiguration,
	invokeControlConfigurationOperation,
} from "../src/configuration";

const configuration: ListmonkConfigurationSummary = {
	profile: "production",
	configFile: "/config/listmonk.json",
	availableProfiles: ["production", "staging"],
	baseUrl: "https://user:secret@example.test/api?token=secret#secret",
	username: "operator",
	dataDirectory: "/data/production",
	sources: {
		baseUrl: { kind: "profile", name: "production.baseUrl" },
		username: { kind: "profile", name: "production.username" },
		dataDirectory: { kind: "profile", name: "production.dataDirectory" },
	},
	authentication: {
		kind: "token",
		source: { kind: "profile", name: "production.tokenFile" },
		reference: "/secrets/listmonk",
	},
};

test("configuration metadata strips URL credentials and undeclared secret fields", async () => {
	const input = {
		...configuration,
		token: "must-not-leak",
		authentication: { ...configuration.authentication, value: "must-not-leak" },
	};
	const result = await getControlConfiguration({ configuration: input });
	expect(result.baseUrl).toBe("https://example.test/api");
	expect(JSON.stringify(result)).not.toContain("must-not-leak");
	expect(result.authentication.reference).toBe("/secrets/listmonk");
	expect(result.availableProfiles).toEqual(["production", "staging"]);
	expect(configuration.baseUrl).toContain("secret");
});

test("the shared invoker requires available configuration metadata", async () => {
	await expect(invokeControlConfigurationOperation({}, {})).rejects.toThrow("unavailable");
	const result = await invokeControlConfigurationOperation({ configuration }, {});
	expect(result.profile).toBe("production");
});
