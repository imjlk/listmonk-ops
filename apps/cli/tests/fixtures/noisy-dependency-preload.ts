// Bun preload for machine-output tests: simulate a dependency that logs to
// stdout while a command runs, the way postgres.js prints server notices with
// console.log unless a notice handler is configured.
const upstreamFetch = globalThis.fetch;

globalThis.fetch = Object.assign(
	(...args: Parameters<typeof fetch>) => {
		console.log("noisy dependency log");
		console.debug("noisy dependency debug");
		return upstreamFetch(...args);
	},
	upstreamFetch,
);
