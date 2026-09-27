/**
 * Adds explicit file extensions to the relative module specifiers of emitted
 * declaration files.
 *
 * The library packages compile with `moduleResolution: "bundler"`, so their
 * sources import sibling modules without extensions and ttsc copies those
 * specifiers into the declarations it emits (`export * from "./client"`).
 * TypeScript consumers that resolve with `node16` or `nodenext` load the
 * published declarations as ECMAScript modules, which must name the runtime
 * file, so they cannot follow such imports. Each library build runs this script
 * on its output directory after emitting declarations. It rewrites every
 * relative specifier to the runtime name of the declaration file it resolves
 * to, the way TypeScript's bundler resolution finds it: `./client.js`, or
 * `./client/index.js` for a directory. `bundler` consumers resolve both forms.
 *
 * Runtime JavaScript is never touched; esbuild bundles it into self-contained
 * entry files. Declaration maps are left as emitted: specifiers only grow, so
 * no line moves and only mappings after a specifier on its own line, such as a
 * closing semicolon, shift. Declaration names keep their columns.
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/** A module specifier string literal; `start` and `end` bound its contents. */
export interface ModuleSpecifier {
	value: string;
	start: number;
	end: number;
}

interface Token {
	kind: "identifier" | "punctuator" | "string";
	text: string;
}

const IDENTIFIER_START = /[A-Za-z_$\u0080-￿]/;
const IDENTIFIER_PART = /[\w$\u0080-￿]/;
const WHITESPACE = /\s/;

/** The index just past a quoted string starting at `start`, if it closes. */
function scanString(source: string, start: number): number | undefined {
	const quote = source[start];
	let index = start + 1;
	while (index < source.length) {
		const char = source[index];
		if (char === "\\") {
			index += 2;
		} else if (char === quote) {
			return index + 1;
		} else if (char === "\n") {
			return undefined;
		} else {
			index += 1;
		}
	}
	return undefined;
}

/**
 * Scans template literal text from `start` to the closing backtick or the next
 * `${`, returning the index after it and whether a substitution opened.
 */
function scanTemplate(
	source: string,
	start: number,
): { end: number; substitution: boolean } {
	let index = start;
	while (index < source.length) {
		const char = source[index];
		if (char === "\\") {
			index += 2;
		} else if (char === "`") {
			return { end: index + 1, substitution: false };
		} else if (char === "$" && source[index + 1] === "{") {
			return { end: index + 2, substitution: true };
		} else {
			index += 1;
		}
	}
	return { end: source.length, substitution: false };
}

function isSpecifierPosition(
	previous: Token | undefined,
	beforePrevious: Token | undefined,
): boolean {
	if (previous?.kind === "identifier") {
		// `from "x"`, a side-effect `import "x"`, and `declare module "x"`.
		return ["from", "import", "module"].includes(previous.text);
	}
	// `import("x")` types and `import x = require("x")`.
	return (
		previous?.kind === "punctuator" &&
		previous.text === "(" &&
		beforePrevious?.kind === "identifier" &&
		["import", "require"].includes(beforePrevious.text)
	);
}

/**
 * Finds the module specifiers of import and export declarations, `import()`
 * types, `require()` calls, and `declare module` blocks in declaration source.
 * Comments, template literals, and other string literals are skipped.
 */
export function findModuleSpecifiers(source: string): ModuleSpecifier[] {
	const specifiers: ModuleSpecifier[] = [];
	// Open brace depth inside each template literal substitution being scanned.
	const substitutionDepths: number[] = [];
	let previous: Token | undefined;
	let beforePrevious: Token | undefined;
	const pushToken = (token: Token): void => {
		beforePrevious = previous;
		previous = token;
	};
	const continueTemplate = (start: number): number => {
		const { end, substitution } = scanTemplate(source, start);
		if (substitution) {
			substitutionDepths.push(0);
		}
		pushToken({ kind: "punctuator", text: "`" });
		return end;
	};

	let index = 0;
	while (index < source.length) {
		const char = source[index] ?? "";
		const next = source[index + 1];
		if (WHITESPACE.test(char)) {
			index += 1;
		} else if (char === "/" && next === "/") {
			const end = source.indexOf("\n", index);
			index = end === -1 ? source.length : end;
		} else if (char === "/" && next === "*") {
			const end = source.indexOf("*/", index + 2);
			index = end === -1 ? source.length : end + 2;
		} else if (char === '"' || char === "'") {
			const end = scanString(source, index);
			if (end === undefined) {
				// Unterminated string: resume after the quote.
				pushToken({ kind: "punctuator", text: char });
				index += 1;
				continue;
			}
			const value = source.slice(index + 1, end - 1);
			if (isSpecifierPosition(previous, beforePrevious)) {
				specifiers.push({ value, start: index + 1, end: end - 1 });
			}
			pushToken({ kind: "string", text: value });
			index = end;
		} else if (char === "`") {
			index = continueTemplate(index + 1);
		} else if (char === "}" && substitutionDepths.at(-1) === 0) {
			substitutionDepths.pop();
			index = continueTemplate(index + 1);
		} else if (IDENTIFIER_START.test(char)) {
			let end = index + 1;
			while (end < source.length && IDENTIFIER_PART.test(source[end] ?? "")) {
				end += 1;
			}
			pushToken({ kind: "identifier", text: source.slice(index, end) });
			index = end;
		} else {
			const depth = substitutionDepths.length - 1;
			if (depth >= 0 && char === "{") {
				substitutionDepths[depth] = (substitutionDepths[depth] ?? 0) + 1;
			} else if (depth >= 0 && char === "}") {
				substitutionDepths[depth] = (substitutionDepths[depth] ?? 1) - 1;
			}
			pushToken({ kind: "punctuator", text: char });
			index += 1;
		}
	}
	return specifiers;
}

export function isRelativeSpecifier(specifier: string): boolean {
	return (
		specifier === "." ||
		specifier === ".." ||
		specifier.startsWith("./") ||
		specifier.startsWith("../")
	);
}

export type FileExists = (path: string) => boolean;

/** Runtime extensions and the declaration extensions TypeScript maps them to. */
const DECLARATION_EXTENSIONS: ReadonlyArray<readonly [string, string]> = [
	[".js", ".d.ts"],
	[".mjs", ".d.mts"],
	[".cjs", ".d.cts"],
];

/** Source extensions that `allowImportingTsExtensions` may leave in place. */
const SOURCE_EXTENSIONS: ReadonlyArray<readonly [string, string]> = [
	[".ts", ".js"],
	[".tsx", ".js"],
	[".mts", ".mjs"],
	[".cts", ".cjs"],
];

function declarationExtensionFor(runtimeExtension: string): string {
	const entry = DECLARATION_EXTENSIONS.find(
		([extension]) => extension === runtimeExtension,
	);
	if (entry === undefined) {
		throw new Error(`No declaration extension for ${runtimeExtension}`);
	}
	return entry[1];
}

/**
 * The form of a relative specifier in the declaration file at
 * `declarationPath` that `node16` and `nodenext` resolution accept, following
 * TypeScript's bundler resolution: a file before a directory index, and `.`,
 * `..`, or a trailing slash as a directory. Returns the specifier unchanged
 * when it already names a runtime file with a declaration or is not relative,
 * and undefined when it resolves to no emitted file.
 */
export function resolveDeclarationSpecifier(
	declarationPath: string,
	specifier: string,
	fileExists: FileExists,
): string | undefined {
	if (!isRelativeSpecifier(specifier)) {
		return specifier;
	}
	const target = resolve(dirname(declarationPath), specifier);
	const directoryOnly =
		specifier.endsWith("/") || /(?:^|\/)\.\.?$/.test(specifier);
	if (!directoryOnly) {
		for (const [runtime, declaration] of DECLARATION_EXTENSIONS) {
			if (
				specifier.endsWith(runtime) &&
				fileExists(`${target.slice(0, -runtime.length)}${declaration}`)
			) {
				return specifier;
			}
		}
		for (const [source, runtime] of SOURCE_EXTENSIONS) {
			if (
				specifier.endsWith(source) &&
				!specifier.endsWith(`.d${source}`) &&
				fileExists(
					`${target.slice(0, -source.length)}${declarationExtensionFor(runtime)}`,
				)
			) {
				return `${specifier.slice(0, -source.length)}${runtime}`;
			}
		}
		if (fileExists(`${target}.d.ts`)) {
			return `${specifier}.js`;
		}
		// Any other file named in full, such as JSON, resolves as written.
		if (fileExists(target)) {
			return specifier;
		}
	}
	if (fileExists(join(target, "index.d.ts"))) {
		return `${specifier.replace(/\/$/, "")}/index.js`;
	}
	return undefined;
}

export interface DeclarationRewrite {
	text: string;
	rewritten: number;
	/** Relative specifiers that name no emitted file. */
	unresolved: string[];
}

export function rewriteDeclarationSource(
	source: string,
	declarationPath: string,
	fileExists: FileExists,
): DeclarationRewrite {
	const parts: string[] = [];
	const unresolved: string[] = [];
	let cursor = 0;
	let rewritten = 0;
	for (const { value, start, end } of findModuleSpecifiers(source)) {
		if (!isRelativeSpecifier(value)) {
			continue;
		}
		const resolved = resolveDeclarationSpecifier(
			declarationPath,
			value,
			fileExists,
		);
		if (resolved === undefined) {
			unresolved.push(value);
		} else if (resolved !== value) {
			parts.push(source.slice(cursor, start), resolved);
			cursor = end;
			rewritten += 1;
		}
	}
	parts.push(source.slice(cursor));
	return { text: parts.join(""), rewritten, unresolved };
}

export function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

/** Every `.d.ts`, `.d.mts`, and `.d.cts` file below a directory, sorted. */
export function listDeclarationFiles(directory: string): string[] {
	return [
		...new Bun.Glob("**/*.d.{ts,mts,cts}").scanSync({
			cwd: directory,
			absolute: true,
			onlyFiles: true,
			followSymlinks: false,
		}),
	].sort();
}

export interface DirectoryRewrite {
	files: number;
	rewrittenFiles: number;
	specifiers: number;
}

/**
 * Rewrites the relative specifiers of every declaration file below a
 * directory in place. Nothing is written when any specifier names a file that
 * was not emitted.
 */
export function rewriteDeclarationDirectory(
	directory: string,
	fileExists: FileExists = isFile,
): DirectoryRewrite {
	const files = listDeclarationFiles(directory);
	if (files.length === 0) {
		throw new Error(`No declaration files found below ${directory}`);
	}
	const updates: Array<{ path: string; text: string }> = [];
	const unresolved: string[] = [];
	let specifiers = 0;
	for (const path of files) {
		const result = rewriteDeclarationSource(
			readFileSync(path, "utf8"),
			path,
			fileExists,
		);
		unresolved.push(
			...result.unresolved.map(
				(specifier) => `${relative(directory, path)}: "${specifier}"`,
			),
		);
		if (result.rewritten > 0) {
			updates.push({ path, text: result.text });
			specifiers += result.rewritten;
		}
	}
	if (unresolved.length > 0) {
		throw new Error(
			`Declarations below ${directory} import files that were not emitted:\n${unresolved.join("\n")}`,
		);
	}
	for (const { path, text } of updates) {
		writeFileSync(path, text);
	}
	return { files: files.length, rewrittenFiles: updates.length, specifiers };
}

if (import.meta.main) {
	const directories = process.argv.slice(2);
	if (directories.length === 0) {
		console.error(
			"Usage: bun scripts/rewrite-declaration-specifiers.ts <directory>...",
		);
		process.exit(2);
	}
	for (const directory of directories) {
		const result = rewriteDeclarationDirectory(resolve(directory));
		console.log(
			`[declarations] ${directory}: added extensions to ${result.specifiers} relative specifiers in ${result.rewrittenFiles} of ${result.files} declaration files`,
		);
	}
}
