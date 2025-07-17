import { createClient } from "@hey-api/openapi-ts";

createClient({
	input: "../../.llms.txt/listmonk-5.0.3.yaml",
	output: "generated",
	plugins: ["@hey-api/typescript", "@hey-api/sdk"],
	parser: {},
});
