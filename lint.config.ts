import type { ITtscLintConfig } from "@ttsc/lint";

export default {
	ignores: ["**/dist/**", "packages/openapi/generated/**"],
	format: {
		// ttsc 0.19.3 panics on trailing-comma diagnostics for mapped types.
		// CI verifies formatting by running `ttsc format` and checking the diff.
		severity: "off",
		semi: true,
		singleQuote: false,
		arrowParens: "always",
		bracketSpacing: true,
		quoteProps: "as-needed",
		trailingComma: "all",
		printWidth: 80,
		tabWidth: 2,
		useTabs: true,
		endOfLine: "lf",
	},
	rules: {
		"no-var": "error",
		"prefer-const": "error",
		eqeqeq: "error",
		"no-self-compare": "error",
		"typescript/no-explicit-any": "warning",
		"typescript/prefer-as-const": "error",
		"object-shorthand": "error",
		"no-useless-rename": "error",
		"typescript/no-import-type-side-effects": "error",
		"typescript/consistent-type-imports": "error",
		"no-debugger": "error",
		"no-throw-literal": "error",
		// The noCheck quality project cannot resolve Bun's async expect matchers.
		"typescript/await-thenable": "off",
	},
} satisfies ITtscLintConfig;
