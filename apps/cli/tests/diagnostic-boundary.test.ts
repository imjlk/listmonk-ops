import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import { ListmonkAbTestIntegration } from "../../../packages/abtest/src/listmonk-integration";
import { prepareCliArgv } from "../src/lib/command";
import {
	captureCliDiagnostics,
	renderCliDiagnostics,
	renderCliError,
} from "../src/lib/output";

afterEach(() => prepareCliArgv([]));

describe("CLI diagnostic boundary", () => {
	test("failed A/B rollback diagnostics remain one bounded machine error", async () => {
		prepareCliArgv(["--format=json"]);
		const stderr = spyOn(console, "error").mockImplementation(() => undefined);
		const stdout = spyOn(console, "info").mockImplementation(() => undefined);
		const captured = captureCliDiagnostics();
		try {
			const integration = new ListmonkAbTestIntegration({
				campaign: { delete: async () => { throw new Error("campaign cleanup failed"); } },
				list: { delete: async () => { throw new Error("list cleanup failed"); } },
			} as unknown as ListmonkClient);
			expect(await integration.rollbackProvisioning({ testId: "test", campaignIds: [1], testListIds: [2] })).toEqual({ deletedCampaignIds: [], deletedListIds: [] });
			console.error("A/B rollback failed:", new Error("service cleanup failed"));
			console.info("service info");
			expect(stderr).not.toHaveBeenCalled();
			expect(stdout).not.toHaveBeenCalled();
			captured.restore();
			renderCliError(new Error("provisioning failed"), captured);
			expect(stderr).toHaveBeenCalledTimes(1);
			const serialized = String(stderr.mock.calls[0]?.[0]);
			const parsed = JSON.parse(serialized);
			expect(parsed.error.message).toBe("provisioning failed");
			expect(parsed.diagnostics).toHaveLength(4);
			expect(serialized).toContain("campaign cleanup failed");
			expect(serialized).not.toMatch(/\\n\s+at |\$bunfs/);
		} finally {
			captured.restore();
			stderr.mockRestore();
			stdout.mockRestore();
		}
	});
	test("caps diagnostics and omits object details without hiding quiet-mode errors", () => {
		prepareCliArgv(["--format=ndjson"]);
		const stderr = spyOn(console, "error").mockImplementation(() => undefined);
		const captured = captureCliDiagnostics();
		try {
			for (let index = 0; index < 100; index++) console.warn("x".repeat(2000), { token: "must-not-serialize" });
			captured.restore();
			renderCliDiagnostics(captured);
			const parsed = JSON.parse(String(stderr.mock.calls[0]?.[0]));
			expect(parsed.diagnostics).toHaveLength(20);
			expect(parsed.diagnostics_truncated).toBe(true);
			expect(parsed.diagnostics.every((item: { message: string }) => item.message.length <= 1024)).toBe(true);
			expect(String(stderr.mock.calls[0]?.[0])).not.toContain("must-not-serialize");
			stderr.mockClear();
			prepareCliArgv(["--format=quiet"]);
			renderCliDiagnostics(captured);
			expect(stderr).not.toHaveBeenCalled();
			renderCliError(new Error("failed"), captured);
			expect(JSON.parse(String(stderr.mock.calls[0]?.[0]))).toEqual({ error: { code: "cli_error", message: "failed" } });
		} finally {
			captured.restore();
			stderr.mockRestore();
		}
	});
});
