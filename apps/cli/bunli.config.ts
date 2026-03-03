export default {
	name: "listmonk-cli",
	version: "0.2.0",
	description: "CLI for Listmonk operations",
	commands: {
		entry: "./src/index.ts",
		directory: "./src/commands",
	},
	build: {
		entry: "./src/index.ts",
		outdir: "./dist/js",
		minify: true,
		sourcemap: false,
	},
};
