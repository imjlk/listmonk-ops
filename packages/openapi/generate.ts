import { createClient } from "@hey-api/openapi-ts";

createClient({
	input: "./spec/listmonk.yaml",
	output: "generated",
	plugins: ["@hey-api/typescript", "@hey-api/sdk"],
	parser: {},
});
