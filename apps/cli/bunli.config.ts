import { defineConfig } from "@bunli/core";
import { completionsPlugin } from "@bunli/plugin-completions";

export default defineConfig({
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
	plugins: [
		completionsPlugin({
			generatedPath: ".bunli/commands.gen.ts",
			commandName: "listmonk-cli",
			executable: "listmonk-cli",
			includeAliases: true,
			includeGlobalFlags: true,
		}),
	],
});
