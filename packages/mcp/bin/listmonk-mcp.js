#!/usr/bin/env node

import { main } from "../dist/index.js";

main().catch((error) => {
	console.error("❌ Unhandled error:", error);
	process.exit(1);
});
