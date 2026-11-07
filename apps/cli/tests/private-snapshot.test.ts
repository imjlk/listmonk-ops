import { expect, test } from "bun:test";
import {
	link,
	mkdtemp,
	readFile,
	readdir,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeNewPrivateSnapshot } from "../src/lib/private-snapshot";

const io = { link, mkdtemp, rm, writeFile };
test("atomic snapshot is absent during staging, private when published, and never overwrites", async () => {
 const dir = await mkdtemp(join(tmpdir(), "private-snapshot-"));
 const target = join(dir, "snapshot.json");
 try {
  await writeNewPrivateSnapshot(target, '{"complete":true}', { ...io, writeFile: async (...args) => {
   expect(await readdir(dir)).not.toContain("snapshot.json");
   await writeFile(...args);
   expect(await readdir(dir)).not.toContain("snapshot.json");
  } });
  expect(await readFile(target, "utf8")).toBe('{"complete":true}');
  if (process.platform !== "win32") expect((await stat(target)).mode & 0o777).toBe(0o600);
  await expect(writeNewPrivateSnapshot(target, "replacement")).rejects.toThrow();
  expect(await readFile(target, "utf8")).toBe('{"complete":true}');
  expect(await readdir(dir)).toEqual(["snapshot.json"]);
 } finally { await rm(dir, { recursive: true, force: true }); }
});
test("a partial staging failure leaves no final snapshot and can be retried", async () => {
 const dir = await mkdtemp(join(tmpdir(), "private-snapshot-failure-"));
 const target = join(dir, "snapshot.json");
 try {
  await expect(writeNewPrivateSnapshot(target, "complete", { ...io, writeFile: async (path) => {
   await writeFile(path, "partial");
				throw new Error("Simulated interrupted write");
  } })).rejects.toThrow("Simulated interrupted write");
  expect(await readdir(dir)).toEqual([]);
  await writeNewPrivateSnapshot(target, "complete");
  expect(await readFile(target, "utf8")).toBe("complete");
 } finally { await rm(dir, { recursive: true, force: true }); }
});
test("publication failure cleans staged bytes without creating a final snapshot", async () => {
 const dir = await mkdtemp(join(tmpdir(), "private-snapshot-publish-"));
 try {
  await expect(writeNewPrivateSnapshot(join(dir, "snapshot.json"), "complete", { ...io, link: () => Promise.reject(new Error("No hard-link support")) })).rejects.toThrow("No hard-link support");
  expect(await readdir(dir)).toEqual([]);
 } finally { await rm(dir, { recursive: true, force: true }); }
});
test.skipIf(process.platform === "win32")(
	"snapshot publication does not follow or replace destination symlinks",
	async () => {
		const dir = await mkdtemp(join(tmpdir(), "private-snapshot-symlink-"));
		try {
			const original = join(dir, "original");
			const target = join(dir, "snapshot.json");
			await writeFile(original, "preserve");
			await symlink(original, target);
			await expect(writeNewPrivateSnapshot(target, "replacement")).rejects.toThrow();
			expect(await readFile(original, "utf8")).toBe("preserve");
			expect((await readdir(dir)).sort()).toEqual(["original", "snapshot.json"]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	},
);
