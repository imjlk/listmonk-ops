// Common validation utilities
export const ValidationUtils = {
	validateEmail(email: string): boolean {
		return EMAIL_REGEX.test(email);
	},

	validatePercentage(value: number): boolean {
		return value >= 0 && value <= 100;
	},

	validateRequired(
		value: string | undefined | null,
		fieldName: string,
	): string {
		if (!value || value.trim().length === 0) {
			throw new ValidationError(`${fieldName} is required`);
		}
		return value.trim();
	},
} as const;

// Common constants
export const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
export const MAX_VARIANTS = 10;
export const MIN_SAMPLE_SIZE = 100;
export const DEFAULT_CONFIDENCE_LEVEL = 0.95;

// Error classes
export class ValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ValidationError";
	}
}

export class ConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConfigurationError";
	}
}

// Date/time utilities
export const DateUtils = {
	formatDate(date: Date): string {
		return date.toISOString().split("T")[0] ?? "";
	},

	formatDateTime(date: Date): string {
		return date.toLocaleString();
	},

	isValidDate(date: unknown): boolean {
		return date instanceof Date && !Number.isNaN(date.getTime());
	},
} as const;

// CLI output utilities
export const OutputUtils = {
	success(message: string): void {
		console.log(`✅ ${message}`);
	},

	error(message: string): void {
		console.error(`❌ ${message}`);
	},

	info(message: string): void {
		console.log(`ℹ️  ${message}`);
	},

	warning(message: string): void {
		console.log(`⚠️  ${message}`);
	},

	table(data: Record<string, unknown>[]): void {
		console.table(data);
	},

	json(data: unknown): void {
		console.log(JSON.stringify(data, null, 2));
	},
} as const;
