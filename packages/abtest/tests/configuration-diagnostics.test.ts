import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
	AbTestService,
	formatAbTestConfigurationDiagnostics,
} from "../src/abtest-service";
import type { ListmonkAbTestIntegration } from "../src/listmonk-integration";
import { StatisticalUtils } from "../src/statistical-utils";
import type { AbTestConfig } from "../src/types";

function createConfig(): AbTestConfig {
	return {
		name: "Diagnostics Test",
		campaignId: "campaign-1",
		variants: [
			{ name: "A", percentage: 50, contentOverrides: { subject: "A" } },
			{ name: "B", percentage: 50, contentOverrides: { subject: "B" } },
		],
		metrics: [{ name: "Open Rate", type: "open_rate" }],
		baseConfig: { subject: "Base subject", body: "Base body", lists: [1] },
		testingMode: "holdout",
		testGroupPercentage: 10,
	};
}

/** Record every console and stream path that reaches stdout or stderr. */
async function captureOutput(run: () => Promise<unknown>) {
	const stdoutSpies = [
		spyOn(process.stdout, "write").mockImplementation(() => true),
		spyOn(console, "log").mockImplementation(() => undefined),
		spyOn(console, "info").mockImplementation(() => undefined),
		spyOn(console, "debug").mockImplementation(() => undefined),
	];
	const warn = spyOn(console, "warn").mockImplementation(() => undefined);
	try {
		await run();
		// mockRestore() clears recorded calls, so snapshot them first.
		return {
			stdoutCalls: stdoutSpies.flatMap((spy) => [...spy.mock.calls]),
			stderrLines: warn.mock.calls.map((call) => String(call[0])),
		};
	} finally {
		for (const spy of [...stdoutSpies, warn]) spy.mockRestore();
	}
}

describe("A/B create configuration diagnostics", () => {
	let previousSilent: string | undefined;
	const integration = {
		getTotalSubscribers: async () => 40,
	} as unknown as ListmonkAbTestIntegration;

	beforeEach(() => {
		previousSilent = process.env.LISTMONK_OPS_ABTEST_SILENT;
		delete process.env.LISTMONK_OPS_ABTEST_SILENT;
	});

	afterEach(() => {
		if (previousSilent === undefined) {
			delete process.env.LISTMONK_OPS_ABTEST_SILENT;
		} else {
			process.env.LISTMONK_OPS_ABTEST_SILENT = previousSilent;
		}
	});

	test("writes the statistical summary to stderr, never stdout", async () => {
		const service = new AbTestService(integration);

		const output = await captureOutput(() =>
			service.recordCreateIntent(createConfig()),
		);

		expect(output.stdoutCalls).toEqual([]);
		expect(output.stderrLines).toContain("💡 A/B Test Recommendations:");
		expect(output.stderrLines).toContain("📊 Statistical Summary:");
		expect(output.stderrLines).toContain("  - Total subscribers: 40");
	});

	test("LISTMONK_OPS_ABTEST_SILENT=1 suppresses the diagnostics", async () => {
		process.env.LISTMONK_OPS_ABTEST_SILENT = "1";
		const service = new AbTestService(integration);

		const output = await captureOutput(() =>
			service.recordCreateIntent(createConfig()),
		);

		expect(output.stdoutCalls).toEqual([]);
		expect(output.stderrLines).toEqual([]);
	});

	test("formats warnings, recommendations, and the summary", () => {
		const lines = formatAbTestConfigurationDiagnostics(
			StatisticalUtils.validateTestConfiguration(40, 10, 2),
		);
		expect(lines[0]).toBe("⚠️ A/B Test Configuration Warnings:");
		expect(lines).toContain("  - Test group: 10% (4 subscribers)");
		expect(lines).toContain("  - Expected sample per variant: 2");
		expect(lines.at(-1)).toBe("  - Recommended test group: 100%");

		const withoutWarnings = formatAbTestConfigurationDiagnostics(
			StatisticalUtils.validateTestConfiguration(40, 10, 2, true),
		);
		expect(withoutWarnings[0]).toBe("💡 A/B Test Recommendations:");
	});
});
