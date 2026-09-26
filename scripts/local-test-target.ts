/**
 * Local test target guard for the smoke run and test-auth bootstrap.
 *
 * Smoke, send, and cleanup checks must reach only the loopback-bound Compose
 * stack unless an operator explicitly opts into another target. The guard
 * inspects the target the CLI actually resolved (`config show`), because a
 * shared connection profile replaces LISTMONK_API_URL and LISTMONK_API_TOKEN.
 */

// WHATWG URL keeps the brackets of an IPv6 literal in `hostname`, so
// `http://[::1]:9000/api` reports `[::1]`, never `::1`.
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set([
	"localhost",
	"127.0.0.1",
	"[::1]",
]);

export type ListmonkTarget = {
	kind: "loopback" | "remote";
	baseUrl: string;
};

export function isLoopbackHostname(hostname: string): boolean {
	return LOOPBACK_HOSTNAMES.has(hostname);
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
	try {
		const value: unknown = JSON.parse(text);
		return typeof value === "object" && value !== null && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

/** Read `baseUrl` from `listmonk-cli --format json config show` output. */
export function readResolvedBaseUrl(configuration: string): string {
	const summary = parseJsonObject(configuration);
	if (summary === undefined) {
		throw new Error("listmonk-cli config show did not return a JSON object");
	}
	const { baseUrl } = summary;
	if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
		throw new Error("listmonk-cli config show did not report a baseUrl");
	}
	return baseUrl;
}

/**
 * Classify the resolved target and fail closed on a non-loopback target
 * unless the operator explicitly allowed remote targets. The returned URL is
 * re-serialized, so it is always a single token without whitespace.
 */
export function resolveLocalTestTarget(
	configuration: string,
	options: { allowRemote: boolean; overrideVariable: string },
): ListmonkTarget {
	const reported = readResolvedBaseUrl(configuration);
	let url: URL;
	try {
		url = new URL(reported);
	} catch {
		throw new Error(
			`listmonk-cli config show reported an invalid baseUrl: ${JSON.stringify(reported)}`,
		);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`Listmonk baseUrl must use HTTP or HTTPS: ${url.href}`);
	}
	// Match the CLI's canonical form, which has no trailing slash.
	const baseUrl = url.href.replace(/\/$/, "");
	if (isLoopbackHostname(url.hostname)) {
		return { kind: "loopback", baseUrl };
	}
	if (!options.allowRemote) {
		throw new Error(
			`Refusing to target non-local Listmonk ${baseUrl}. Set ${options.overrideVariable}=1 only when that exact target is authorized.`,
		);
	}
	return { kind: "remote", baseUrl };
}

// A positive integer (Listmonk records) or an opaque token such as an A/B
// test id; either is safe to pass back to the CLI as one argument.
const RECORD_ID_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/**
 * Read the id of a record created by CLI `--format json` output, only when
 * the record echoes the unique value it was created with. Cleanup therefore
 * never deletes a resource this run did not create.
 */
export function readCreatedRecordId(
	output: string,
	match: { key: string; field: string; value: string },
): string | undefined {
	const record = parseJsonObject(output)?.[match.key];
	if (typeof record !== "object" || record === null) {
		return undefined;
	}
	const { id, [match.field]: value } = record as Record<string, unknown>;
	if (value !== match.value) {
		return undefined;
	}
	if (typeof id === "number") {
		return Number.isSafeInteger(id) && id > 0 ? String(id) : undefined;
	}
	return typeof id === "string" && RECORD_ID_TOKEN.test(id) ? id : undefined;
}

const USAGE = `Usage (stdin is CLI --format json output):
  bun scripts/local-test-target.ts resolve <OVERRIDE_VARIABLE>
  bun scripts/local-test-target.ts created-id <key> <field> <value>`;

if (import.meta.main) {
	const [command, ...args] = process.argv.slice(2);
	const overrideVariable = args[0];
	if (
		command === "resolve" &&
		args.length === 1 &&
		overrideVariable !== undefined &&
		/^[A-Z_][A-Z0-9_]*$/.test(overrideVariable)
	) {
		try {
			const target = resolveLocalTestTarget(await Bun.stdin.text(), {
				allowRemote: process.env[overrideVariable] === "1",
				overrideVariable,
			});
			// Shell-friendly "<loopback|remote> <baseUrl>"; canonical URLs have no spaces.
			console.log(`${target.kind} ${target.baseUrl}`);
		} catch (error) {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		}
	} else if (command === "created-id" && args.length === 3) {
		const [key, field, value] = args as [string, string, string];
		const id = readCreatedRecordId(await Bun.stdin.text(), {
			key,
			field,
			value,
		});
		if (id !== undefined) {
			console.log(id);
		}
	} else {
		console.error(USAGE);
		process.exit(2);
	}
}
