// Base Command interface
export interface Command<TInput, TOutput> {
	execute(input: TInput): Promise<TOutput>;
}

export abstract class BaseCommand<TInput, TOutput>
	implements Command<TInput, TOutput>
{
	abstract execute(input: TInput): Promise<TOutput>;

	protected validate(_input: TInput): void {
		// Common validation logic can be implemented here
	}
}
