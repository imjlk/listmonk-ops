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
			dryRun: true;
		}
	: HasDestructiveMaintenance<Effects> extends true
		? {
				confirmation: "required";
				audit: "required";
				dryRun: true;
			}
		: HasEffect<Effects, "maintenance"> extends true
			? {
					confirmation: "never";
					audit: "required";
					dryRun: true;
				}
	: HasEffect<Effects, "webhook"> extends true
		? {
				confirmation: "required";
				audit: "required";
				dryRun: false;
			}
		: HasBulkDelivery<Effects> extends true
		? {
				confirmation: "required";
				audit: "required";
				dryRun: false;
			}
		: HasEffect<Effects, "delete"> extends true
			? {
					confirmation: "required";
					audit: "required";
					dryRun: false;
				}
			: HasIrreversibleWrite<Effects> extends true
				? {
						confirmation: "required";
						audit: "required";
						dryRun: false;
					}
				: HasEffect<Effects, "delivery" | "write"> extends true
					? {
							confirmation: "never";
							audit: "required";
							dryRun: false;
						}
					: {
							confirmation: "never";
							audit: "optional";
							dryRun: false;
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
	if (hasEffectKind(effects, ["suppression"])) {
		return {
			confirmation: "required",
			audit: "required",
			dryRun: true,
		};
	}
	if (
		effects.some(
			(effect) =>
				effect.kind === "maintenance" && effect.destructive,
		)
	) {
		return {
			confirmation: "required",
			audit: "required",
			dryRun: true,
		};
	}
	if (hasEffectKind(effects, ["maintenance"])) {
		return {
			confirmation: "never",
			audit: "required",
			dryRun: true,
		};
	}
	if (hasEffectKind(effects, ["webhook"])) {
		return {
			confirmation: "required",
			audit: "required",
			dryRun: false,
		};
	}
	if (
		effects.some(
			(effect) =>
				effect.kind === "delivery" && effect.audience === "bulk",
		) ||
		hasEffectKind(effects, ["delete"])
	) {
		return {
			confirmation: "required",
			audit: "required",
			dryRun: false,
		};
	}
	if (
		effects.some(
			(effect) => effect.kind === "write" && effect.reversible === false,
		)
	) {
		return {
			confirmation: "required",
			audit: "required",
			dryRun: false,
		};
	}
	if (hasEffectKind(effects, ["delivery", "write"])) {
		return {
			confirmation: "never",
			audit: "required",
			dryRun: false,
		};
	}
	return {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	};
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
