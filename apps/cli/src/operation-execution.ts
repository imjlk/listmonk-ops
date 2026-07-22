import {
	createOperationAuditExecutionId,
	recordOperationAudit,
	type OperationAuditEvent,
	type OperationAuditStoreOptions,
	type RecordOperationAuditInput,
} from "@listmonk-ops/common";
import {
	assertOperationConfirmation,
	getOperationEffectiveDryRun,
	getOperationExecutionPolicy,
	type OperationCatalogItem,
	type OperationExecutionPolicy,
} from "@listmonk-ops/operations";
import { toErrorMessage } from "./lib/command-utils";
import { cliOperationCatalog } from "./operation-catalog";

const cliRuntimeInputKeys = new Set(["confirm", "interactive", "tui"]);

export type CliOperationExecution = Readonly<{
	operation: OperationCatalogItem;
	policy: OperationExecutionPolicy;
	confirmed: boolean;
	dryRun: boolean;
}>;

export type CliOperationAuditRecorder = (
	input: RecordOperationAuditInput,
	options?: OperationAuditStoreOptions,
) => Promise<unknown>;

export class UnknownCliOperationError extends Error {
	public readonly operationId: string;

	public constructor(operationId: string) {
		super(`Unknown CLI operation: ${operationId}`);
		this.name = "UnknownCliOperationError";
		this.operationId = operationId;
	}
}

export class CliOperationAuditStartError extends Error {
	public readonly operationId: string;

	public constructor(operationId: string, cause: unknown) {
		super(
			`Unable to start audit for operation ${operationId}: ${toErrorMessage(cause)}`,
			{ cause },
		);
		this.name = "CliOperationAuditStartError";
		this.operationId = operationId;
	}
}

function normalizeCliOperationInput(
	input: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(input)
			.filter(([key]) => !cliRuntimeInputKeys.has(key))
			.map(([key, value]) => [key.replaceAll("-", "_"), value]),
	);
}

function findCliOperation(operationId: string): OperationCatalogItem {
	const entry = cliOperationCatalog.entries.find(
		(candidate) => candidate.operation.id === operationId,
	);
	if (!entry) {
		throw new UnknownCliOperationError(operationId);
	}
	return entry.operation;
}

/**
 * Resolves the shared execution policy for a CLI command without introducing
 * dynamic dispatch. Command handlers retain their named operation invokers;
 * this boundary only evaluates safety metadata and audit state.
 */
export function getCliOperationExecution(
	operationId: string,
	input: Readonly<Record<string, unknown>>,
	confirmed = input.confirm === true,
): CliOperationExecution {
	const operation = findCliOperation(operationId);
	const policy = getOperationExecutionPolicy(operation);
	const operationInput = normalizeCliOperationInput(input);
	const resolvedDryRun = policy.dryRunSupported
		? getOperationEffectiveDryRun(operation, operationInput)
		: undefined;
	const dryRun =
		policy.dryRunSupported &&
		(resolvedDryRun ?? (operationInput.dry_run === true));

	return { operation, policy, confirmed, dryRun };
}

async function recordCliOperationAudit(
	execution: CliOperationExecution,
	executionId: string,
	event: OperationAuditEvent,
	recordAudit: CliOperationAuditRecorder | undefined,
	auditStoreOptions: OperationAuditStoreOptions,
): Promise<void> {
	const input: RecordOperationAuditInput = {
		executionId,
		surface: "cli",
		operationId: execution.operation.id,
		event,
		confirmationRequired: execution.policy.confirmationRequired,
		confirmed: execution.confirmed,
		dryRun: execution.dryRun,
	};
	if (recordAudit) {
		await recordAudit(input, auditStoreOptions);
		return;
	}
	await recordOperationAudit(input, auditStoreOptions);
}

async function completeCliOperationExecution(
	execution: CliOperationExecution,
	executionId: string | undefined,
	event: "succeeded" | "failed",
	recordAudit: CliOperationAuditRecorder | undefined,
	auditStoreOptions: OperationAuditStoreOptions,
	onAuditError: (message: string) => void,
): Promise<void> {
	if (!executionId) {
		return;
	}

	try {
		await recordCliOperationAudit(
			execution,
			executionId,
			event,
			recordAudit,
			auditStoreOptions,
		);
	} catch (error) {
		// A durable started event already records the remote attempt. Replacing a
		// remote result or error with a terminal audit failure could invite an
		// unsafe retry, so report it without changing command semantics.
		reportCliOperationAuditError(
			onAuditError,
			`Unable to record CLI operation audit ${event} for ${execution.operation.id}: ${toErrorMessage(error)}`,
		);
	}
}

function reportCliOperationAuditError(
	onAuditError: (message: string) => void,
	message: string,
): void {
	try {
		onAuditError(message);
	} catch {
		try {
			console.error(message);
		} catch {
			// Error reporting must not shadow a remote operation result or error.
		}
	}
}

export async function executeCliOperation<Result>(config: {
	operationId: string;
	input: Readonly<Record<string, unknown>>;
	confirmed?: boolean;
	invoke: () => Promise<Result>;
	auditStoreOptions?: OperationAuditStoreOptions;
	recordAudit?: CliOperationAuditRecorder;
	onAuditError?: (message: string) => void;
}): Promise<Result> {
	const execution = getCliOperationExecution(
		config.operationId,
		config.input,
		config.confirmed,
	);
	const auditStoreOptions = config.auditStoreOptions ?? {};
	const recordAudit = config.recordAudit;
	const onAuditError = config.onAuditError ?? ((message: string) => console.error(
		message,
	));
	let executionId: string | undefined;

	if (execution.policy.auditRequired) {
		executionId = createOperationAuditExecutionId();
		try {
			await recordCliOperationAudit(
				execution,
				executionId,
				"started",
				recordAudit,
				auditStoreOptions,
			);
		} catch (error) {
			throw new CliOperationAuditStartError(execution.operation.id, error);
		}
	}

	try {
		assertOperationConfirmation(execution.operation, execution.confirmed);
	} catch (error) {
		if (executionId) {
			try {
				await recordCliOperationAudit(
					execution,
					executionId,
					"blocked",
					recordAudit,
					auditStoreOptions,
				);
			} catch (auditError) {
				reportCliOperationAuditError(
					onAuditError,
					`Unable to record blocked CLI operation audit for ${execution.operation.id}: ${toErrorMessage(auditError)}`,
				);
			}
		}
		throw error;
	}

	try {
		const result = await config.invoke();
		await completeCliOperationExecution(
			execution,
			executionId,
			"succeeded",
			recordAudit,
			auditStoreOptions,
			onAuditError,
		);
		return result;
	} catch (error) {
		await completeCliOperationExecution(
			execution,
			executionId,
			"failed",
			recordAudit,
			auditStoreOptions,
			onAuditError,
		);
		throw error;
	}
}
