import { describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import { statSync } from "node:fs";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import {
	InMemoryConversionEventStore,
	prepareConversionStoreFiles,
	SqliteConversionEventStore,
	resolveConversionStorePath,
	ConversionEventValidationError,
	validateConversionEvent,
	type ConversionEventInput,
} from "../src/conversion-events";

function permissionsOf(path: string): number {
	return statSync(path).mode & 0o777;
}

function makeEvent(
	overrides: Partial<ConversionEventInput> = {},
): ConversionEventInput {
	return {
		eventId: "evt-1",
		testId: "test-1",
		variantId: "A",
		subscriberUuid: "uuid-1",
		event: "purchase",
		occurredAt: "2026-07-24T12:00:00Z",
		...overrides,
	};
}

describe("validateConversionEvent", () => {
	it("accepts a valid event", () => {
		expect(() => validateConversionEvent(makeEvent())).not.toThrow();
	});

	it("accepts an event with value and currency", () => {
		expect(() =>
			validateConversionEvent(
				makeEvent({ value: 99.99, currency: "USD" }),
			),
		).not.toThrow();
	});

	it("rejects missing eventId", () => {
		expect(() =>
			validateConversionEvent(makeEvent({ eventId: "" })),
		).toThrow(ConversionEventValidationError);
	});

	it("rejects missing subscriberUuid", () => {
		expect(() =>
			validateConversionEvent(makeEvent({ subscriberUuid: "" })),
		).toThrow(ConversionEventValidationError);
	});

	it("rejects negative value", () => {
		expect(() =>
			validateConversionEvent(makeEvent({ value: -1, currency: "USD" })),
		).toThrow(ConversionEventValidationError);
	});

	it("rejects value without currency", () => {
		expect(() =>
			validateConversionEvent(makeEvent({ value: 10 })),
		).toThrow(ConversionEventValidationError);
	});

	it("rejects malformed occurredAt", () => {
		expect(() =>
			validateConversionEvent(makeEvent({ occurredAt: "not-a-date" })),
		).toThrow(ConversionEventValidationError);
	});
});

describe("InMemoryConversionEventStore", () => {
	it("records an event and returns created", async () => {
		const store = new InMemoryConversionEventStore();
		const result = await store.record(makeEvent());
		expect(result).toBe("created");
	});

	it("returns duplicate for an identical retry and rejects conflicting IDs", async () => {
		const store = new InMemoryConversionEventStore();
		await store.record(makeEvent({ eventId: "evt-1" }));
		const result = await store.record(makeEvent({ eventId: "evt-1" }));
		expect(result).toBe("duplicate");
		await expect(store.record(makeEvent({ event: "different" }))).rejects.toThrow("different conversion");
	});

	it("aggregates events by variant", async () => {
		const store = new InMemoryConversionEventStore();
		await store.record(
			makeEvent({ eventId: "e1", variantId: "A", subscriberUuid: "u1" }),
		);
		await store.record(
			makeEvent({ eventId: "e2", variantId: "A", subscriberUuid: "u2" }),
		);
		await store.record(
			makeEvent({ eventId: "e3", variantId: "B", subscriberUuid: "u3" }),
		);
		const aggregates = await store.aggregate("test-1");
		expect(aggregates).toHaveLength(2);
		const variantA = aggregates.find((a) => a.variantId === "A");
		expect(variantA?.totalEvents).toBe(2);
		expect(variantA?.uniqueSubscribers).toBe(2);
	});

	it("aggregates revenue correctly", async () => {
		const store = new InMemoryConversionEventStore();
		await store.record(
			makeEvent({
				eventId: "e1",
				variantId: "A",
				value: 50,
				currency: "USD",
			}),
		);
		await store.record(
			makeEvent({
				eventId: "e2",
				variantId: "A",
				value: 30,
				currency: "USD",
			}),
		);
		const aggregates = await store.aggregate("test-1");
		const variantA = aggregates.find((a) => a.variantId === "A");
		expect(variantA?.totalValue).toBe(80);
		expect(variantA?.currency).toBe("USD");
	});

	it("rejects events for unassigned subscribers", async () => {
		const lookup = (_testId: string, _variantId: string, uuid: string) =>
			uuid === "known-uuid";
		const store = new InMemoryConversionEventStore(lookup);
		await expect(
			store.record(makeEvent({ subscriberUuid: "unknown-uuid" })),
		).rejects.toThrow(ConversionEventValidationError);
		await expect(
			store.record(makeEvent({ subscriberUuid: "known-uuid" })),
		).resolves.toBe("created");
	});

	it("rejects events outside the attribution window", async () => {
		const store = new InMemoryConversionEventStore(undefined, {
			startTime: new Date("2026-07-24T00:00:00Z").getTime(),
			endTime: new Date("2026-07-25T00:00:00Z").getTime(),
		});
		await expect(
			store.record(
				makeEvent({ occurredAt: "2026-07-23T12:00:00Z" }),
			),
		).rejects.toThrow("attribution window");
		await expect(
			store.record(
				makeEvent({ occurredAt: "2026-07-24T12:00:00Z" }),
			),
		).resolves.toBe("created");
	});

	it("returns empty array for test with no events", async () => {
		const store = new InMemoryConversionEventStore();
		const aggregates = await store.aggregate("no-events-test");
		expect(aggregates).toEqual([]);
	});

	it("does not store PII (email/name)", async () => {
		const store = new InMemoryConversionEventStore();
		await store.record(makeEvent());
		const aggregates = await store.aggregate("test-1");
		const json = JSON.stringify(aggregates);
		expect(json).not.toContain("email");
		expect(json).not.toContain("@");
		expect(json).not.toContain("name");
	});
});

describe("SqliteConversionEventStore", () => {
	it("honors the explicit conversion-store override even with a custom test store", () => {
		const previous = process.env.LISTMONK_OPS_ABTEST_CONVERSION_STORE;
		try {
			delete process.env.LISTMONK_OPS_ABTEST_CONVERSION_STORE;
			expect(resolveConversionStorePath("/tmp/custom/abtests.json")).toBe("/tmp/custom/abtest-conversions.sqlite");
			process.env.LISTMONK_OPS_ABTEST_CONVERSION_STORE = "/tmp/overridden-conversions.sqlite";
			expect(resolveConversionStorePath("/tmp/custom/abtests.json")).toBe("/tmp/overridden-conversions.sqlite");
		} finally {
			if (previous === undefined) delete process.env.LISTMONK_OPS_ABTEST_CONVERSION_STORE;
			else process.env.LISTMONK_OPS_ABTEST_CONVERSION_STORE = previous;
		}
	});
	it("persists events across instances and deduplicates concurrent writes", async () => {
		const directory = await mkdtemp(join(tmpdir(), "abtest-conversions-"));
		try {
			const path = join(directory, "events.sqlite");
			const first = new SqliteConversionEventStore(path);
			const second = new SqliteConversionEventStore(path);
			const results = await Promise.all([first.record(makeEvent()), second.record(makeEvent())]);
			expect(results.sort()).toEqual(["created", "duplicate"]);
			expect(await second.aggregate("test-1")).toMatchObject([
				{
					variantId: "A",
					totalEvents: 1,
					uniqueSubscribers: 1,
				},
			]);
			await expect(second.record(makeEvent({ testId: "other" }))).rejects.toThrow("different conversion");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("rejects cross-variant subscriber attribution and mixed revenue currencies", async () => {
		const directory = await mkdtemp(join(tmpdir(), "abtest-conversions-"));
		try {
			const store = new SqliteConversionEventStore(
				join(directory, "events.sqlite"),
			);
			await store.record(makeEvent({ value: 10, currency: "USD" }));
			await expect(store.record(makeEvent({ eventId: "other-variant", variantId: "B" }))).rejects.toThrow("another variant");
			await expect(store.record(makeEvent({ eventId: "other-currency", subscriberUuid: "uuid-2", value: 10, currency: "KRW" }))).rejects.toThrow("another currency");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it.skipIf(process.platform === "win32")(
		"creates owner-only directories and database files",
		async () => {
			const root = await mkdtemp(join(tmpdir(), "abtest-conversion-modes-"));
			try {
				const directory = join(root, "nested", "store");
				const path = join(directory, "abtest-conversions.sqlite");
				await new SqliteConversionEventStore(path).record(makeEvent());

				expect(permissionsOf(join(root, "nested"))).toBe(0o700);
				expect(permissionsOf(directory)).toBe(0o700);
				expect(permissionsOf(path)).toBe(0o600);
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		},
	);

	it.skipIf(process.platform === "win32")(
		"tightens a database an earlier version created with broader permissions",
		async () => {
			const root = await mkdtemp(join(tmpdir(), "abtest-conversion-modes-"));
			try {
				const path = join(root, "abtest-conversions.sqlite");
				new DatabaseSync(path).close();
				await chmod(path, 0o644);
				// The pre-existing parent directory is left as the operator set
				// it: the store path may be overridden into a shared directory.
				await chmod(root, 0o755);

				const store = new SqliteConversionEventStore(path);
				await store.record(makeEvent());

				expect(permissionsOf(path)).toBe(0o600);
				expect(permissionsOf(root)).toBe(0o755);
				expect(await store.aggregate("test-1")).toHaveLength(1);
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		},
	);

	it.skipIf(process.platform === "win32")(
		"tightens leftover journal, WAL, and shared-memory files",
		async () => {
			const root = await mkdtemp(join(tmpdir(), "abtest-conversion-modes-"));
			try {
				const path = join(root, "abtest-conversions.sqlite");
				const companions = ["-journal", "-wal", "-shm"].map(
					(suffix) => `${path}${suffix}`,
				);
				for (const file of [path, ...companions]) {
					await writeFile(file, "", { mode: 0o644 });
					await chmod(file, 0o644);
				}

				prepareConversionStoreFiles(path);

				for (const file of [path, ...companions]) {
					expect(permissionsOf(file)).toBe(0o600);
				}
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		},
	);

	it.skipIf(process.platform === "win32")(
		"rejects dangling symlinks at the database and companion paths",
		async () => {
			const root = await mkdtemp(join(tmpdir(), "abtest-conversion-links-"));
			try {
				const path = join(root, "events.sqlite");
				const target = join(root, "outside.sqlite");
				await symlink(target, path);

				await expect(
					new SqliteConversionEventStore(path).record(makeEvent()),
				).rejects.toThrow("must not be a symbolic link");
				expect(() => statSync(target)).toThrow();

				await rm(path);
				await writeFile(path, "", { mode: 0o600 });
				await symlink(target, `${path}-wal`);

				expect(() => prepareConversionStoreFiles(path)).toThrow(
					"must not be a symbolic link",
				);
				expect(() => statSync(target)).toThrow();
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		},
	);

	it.skipIf(process.platform === "win32")(
		"warns when the OS refuses to tighten an existing store file",
		async () => {
			const root = await mkdtemp(join(tmpdir(), "abtest-conversion-modes-"));
			const path = join(root, "events.sqlite");
			await writeFile(path, "", { mode: 0o644 });
			await chmod(path, 0o644);
			const originalChmodSync = fs.chmodSync;
			const permissionError = Object.assign(new Error("permission denied"), {
				code: "EPERM",
			});
			const chmodSpy = spyOn(fs, "chmodSync").mockImplementation(
				(candidatePath, mode) => {
					if (candidatePath === path) throw permissionError;
					return originalChmodSync(candidatePath, mode);
				},
			);
			const warning = spyOn(console, "warn").mockImplementation(() => undefined);
			try {
				prepareConversionStoreFiles(path);

				expect(warning).toHaveBeenCalledWith(
					`Could not restrict conversion store file to owner-only (EPERM): ${path}`,
				);
				expect(permissionsOf(path)).toBe(0o644);
			} finally {
				warning.mockRestore();
				chmodSpy.mockRestore();
				await rm(root, { recursive: true, force: true });
			}
		},
	);

	it("rejects revenue that would make the aggregate non-finite", async () => {
		const directory = await mkdtemp(join(tmpdir(), "abtest-conversions-"));
		try {
			const store = new SqliteConversionEventStore(join(directory, "events.sqlite"));
			await store.record(makeEvent({ eventId: "large-1", value: 1e308, currency: "USD" }));
			await expect(store.record(makeEvent({ eventId: "large-2", subscriberUuid: "uuid-2", value: 1e308, currency: "USD" }))).rejects.toThrow("overflow");
			expect((await store.aggregate("test-1"))[0]?.totalValue).toBe(1e308);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
