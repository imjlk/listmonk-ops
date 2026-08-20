export class AbTestNotFoundError extends Error {
	constructor(testId: string) {
		super(`Test with ID ${testId} not found`);
		this.name = "AbTestNotFoundError";
	}
}

export class AbTestConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AbTestConflictError";
	}
}
