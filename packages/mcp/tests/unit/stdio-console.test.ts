import { describe, expect, test } from "bun:test";
import { Console } from "node:console";
import { Writable } from "node:stream";
import {
	routeConsoleStdoutToStderr,
	STDOUT_CONSOLE_METHODS,
} from "../../src/stdio-console.js";

function createCollector() {
	const chunks: string[] = [];
	const stream = new Writable({
		write(chunk, _encoding, callback) {
			chunks.push(String(chunk));
			callback();
		},
	});
	return { stream, text: () => chunks.join("") };
}

describe("stdio console routing", () => {
	test("routes every stdout-bound console method to stderr until restored", () => {
		const stdout = createCollector();
		const stderr = createCollector();
		const target = new Console({ stdout: stdout.stream, stderr: stdout.stream });
		const original = target.log;

		const restore = routeConsoleStdoutToStderr(target, stderr.stream);
		try {
			target.log("log line");
			target.info("info line");
			target.debug("debug line");
			target.trace("trace line");
			target.dir({ dirKey: true });
			target.dirxml("dirxml line");
			target.table([{ column: "table cell" }]);
			target.count("counter");
			target.countReset("counter");
			target.group("group label");
			target.log("nested line");
			target.groupEnd();
			target.groupCollapsed("collapsed label");
			target.groupEnd();
			target.time("timer");
			target.timeLog("timer", "checkpoint");
			target.timeEnd("timer");
		} finally {
			restore();
		}

		expect(stdout.text()).toBe("");
		const routed = stderr.text();
		for (const expected of [
			"log line",
			"info line",
			"debug line",
			"dirKey: true",
			"dirxml line",
			"table cell",
			"counter: 1",
			"group label\n  nested line",
			"collapsed label",
			"checkpoint",
		]) {
			expect(routed).toContain(expected);
		}
		expect(routed).toMatch(/timer: [\d.]+ms\n$/);

		expect(target.log).toBe(original);
		target.log("after restore");
		expect(stdout.text()).toBe("after restore\n");
		expect(STDOUT_CONSOLE_METHODS).toContain("trace");
	});
});
