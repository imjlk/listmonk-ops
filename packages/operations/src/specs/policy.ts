import type { OperationEffect } from "./effect";

export interface OperationPolicy {
	readonly confirmation: "never" | "required";
	readonly audit: "optional" | "required";
	readonly dryRun: boolean;
}

type EffectOfKind<
	Effects extends readonly OperationEffect[],
	Kind extends OperationEffect["kind"],
> = Extract<Effects[number], { kind: Kind }>;

type HasEffect<
	Effects extends readonly OperationEffect[],
	Kind extends OperationEffect["kind"],
> = [EffectOfKind<Effects, Kind>] extends [never] ? false : true;

type HasIrreversibleWrite<Effects extends readonly OperationEffect[]> = [
	Extract<Effects[number], { kind: "write"; reversible: false }>,
] extends [never]
	? false
	: true;

type HasBulkDelivery<Effects extends readonly OperationEffect[]> = [
	Extract<Effects[number], { kind: "delivery"; audience: "bulk" }>,
] extends [never]
	? false
	: true;

type HasDestructiveMaintenance<Effects extends readonly OperationEffect[]> = [
	Extract<Effects[number], { kind: "maintenance"; destructive: true }>,
] extends [never]
	? false
	: true;

type HasPreviewDeclaration<
	Effects extends readonly OperationEffect[],
	Value extends boolean,
> = [Extract<Effects[number], { preview: Value }>] extends [never]
	? false
	: true;

type DryRunForEffects<
	Effects extends readonly OperationEffect[],
	Default extends boolean,
> = HasPreviewDeclaration<Effects, true> extends true
	? HasPreviewDeclaration<Effects, false> extends true
		? never
		: true
	: HasPreviewDeclaration<Effects, false> extends true
		? false
		: Default;

/**
 * Safety precedence is intentionally conservative:
 * suppression requires a preview and confirmation; outbound webhook effects,
 * bulk delivery, and deletion require confirmation; irreversible writes also
 * require confirmation. A single-recipient delivery is audited but does not
 * require a destructive confirmation. Reversible writes are audited; pure
 * reads need neither. Higher tiers win when an operation declares more than
 * one effect.
 */
export type PolicyForEffects<
	Effects extends readonly OperationEffect[],
> = HasEffect<Effects, "suppression"> extends true
	? {
			confirmation: "required";
			audit: "required";
			dryRun: DryRunForEffects<Effects, true>;
		}
	: HasDestructiveMaintenance<Effects> extends true
		? {
				confirmation: "required";
				audit: "required";
				dryRun: DryRunForEffects<Effects, true>;
			}
		: HasEffect<Effects, "maintenance"> extends true
			? {
					confirmation: "never";
					audit: "required";
					dryRun: DryRunForEffects<Effects, true>;
				}
	: HasEffect<Effects, "webhook"> extends true
		? {
				confirmation: "required";
				audit: "required";
				dryRun: DryRunForEffects<Effects, false>;
			}
		: HasBulkDelivery<Effects> extends true
		? {
				confirmation: "required";
				audit: "required";
				dryRun: DryRunForEffects<Effects, false>;
			}
		: HasEffect<Effects, "delete"> extends true
			? {
					confirmation: "required";
					audit: "required";
					dryRun: DryRunForEffects<Effects, false>;
				}
			: HasIrreversibleWrite<Effects> extends true
				? {
						confirmation: "required";
						audit: "required";
						dryRun: DryRunForEffects<Effects, false>;
					}
				: HasEffect<Effects, "delivery" | "write"> extends true
					? {
							confirmation: "never";
							audit: "required";
							dryRun: DryRunForEffects<Effects, false>;
						}
					: {
							confirmation: "never";
							audit: "optional";
							dryRun: DryRunForEffects<Effects, false>;
						};

function hasEffectKind(
	effects: readonly OperationEffect[],
	kinds: readonly OperationEffect["kind"][],
): boolean {
	return effects.some((effect) => kinds.includes(effect.kind));
}

export function expectedPolicyForEffects(
	effects: readonly OperationEffect[],
): OperationPolicy {
	const declaredPreview = new Set(
		effects
			.map((effect) =>
				"preview" in effect ? effect.preview : undefined,
			)
			.filter((preview): preview is boolean => preview !== undefined),
	);
	if (declaredPreview.size > 1) {
		throw new TypeError(
			"Operation effects must not declare conflicting preview capabilities",
		);
	}
	const withDeclaredPreview = (
		policy: OperationPolicy,
	): OperationPolicy => ({
		...policy,
		dryRun:
			declaredPreview.size === 0
				? policy.dryRun
				: declaredPreview.values().next().value!,
	});
	if (hasEffectKind(effects, ["suppression"])) {
		return withDeclaredPreview({
			confirmation: "required",
			audit: "required",
			dryRun: true,
		});
	}
	if (
		effects.some(
			(effect) =>
				effect.kind === "maintenance" && effect.destructive,
		)
	) {
		return withDeclaredPreview({
			confirmation: "required",
			audit: "required",
			dryRun: true,
		});
	}
	if (hasEffectKind(effects, ["maintenance"])) {
		return withDeclaredPreview({
			confirmation: "never",
			audit: "required",
			dryRun: true,
		});
	}
	if (hasEffectKind(effects, ["webhook"])) {
		return withDeclaredPreview({
			confirmation: "required",
			audit: "required",
			dryRun: false,
		});
	}
	if (
		effects.some(
			(effect) =>
				effect.kind === "delivery" && effect.audience === "bulk",
		) ||
		hasEffectKind(effects, ["delete"])
	) {
		return withDeclaredPreview({
			confirmation: "required",
			audit: "required",
			dryRun: false,
		});
	}
	if (
		effects.some(
			(effect) => effect.kind === "write" && effect.reversible === false,
		)
	) {
		return withDeclaredPreview({
			confirmation: "required",
			audit: "required",
			dryRun: false,
		});
	}
	if (hasEffectKind(effects, ["delivery", "write"])) {
		return withDeclaredPreview({
			confirmation: "never",
			audit: "required",
			dryRun: false,
		});
	}
	return withDeclaredPreview({
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	});
}

export function assertPolicyMatchesEffects(
	effects: readonly OperationEffect[],
	policy: OperationPolicy,
): void {
	const expected = expectedPolicyForEffects(effects);
	if (
		policy.confirmation !== expected.confirmation ||
		policy.audit !== expected.audit ||
		policy.dryRun !== expected.dryRun
	) {
		throw new TypeError(
			`Operation policy ${JSON.stringify(policy)} does not match effects; expected ${JSON.stringify(expected)}`,
		);
	}
}
