import { link, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

type SnapshotFiles = { link: typeof link; mkdtemp: typeof mkdtemp; rm: typeof rm; writeFile: typeof writeFile };
const files: SnapshotFiles = { link, mkdtemp, rm, writeFile };

/** Same-filesystem hard-link publication is atomic and never clobbers a destination. */
export async function writeNewPrivateSnapshot(path: string, content: string, io: SnapshotFiles = files): Promise<void> {
	const destination = resolve(path);
 // A private sibling directory keeps unfinished bytes unobservable at the final path.
	const temporary = await io.mkdtemp(
		join(dirname(destination), ".campaign-review-"),
	);
	try {
		const staged = join(temporary, "snapshot.json");
		await io.writeFile(staged, content, {
			encoding: "utf8",
			mode: 0o600,
			flag: "wx",
		});
		await io.link(staged, destination);
	} finally {
		await io.rm(temporary, { recursive: true, force: true });
	}
}
