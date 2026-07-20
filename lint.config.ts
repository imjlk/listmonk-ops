import type { ITtscLintConfig } from "@ttsc/lint";

export default {
	format: {
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
		"prefer-const": "warning",
	},
} satisfies ITtscLintConfig;
