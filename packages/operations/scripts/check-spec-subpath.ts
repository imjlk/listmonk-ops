type BuiltSpecModule = {
	emailOperationsSpec?: {
		operations?: unknown;
	};
};

const specModule = (await import(
	"@listmonk-ops/operations/specs"
)) as BuiltSpecModule;

if (
	typeof specModule.emailOperationsSpec !== "object" ||
	!Array.isArray(specModule.emailOperationsSpec?.operations)
) {
	throw new TypeError(
		"The @listmonk-ops/operations/specs build does not expose emailOperationsSpec",
	);
}

if (specModule.emailOperationsSpec.operations.length === 0) {
	throw new TypeError(
		"The @listmonk-ops/operations/specs build contains no operation specs",
	);
}
