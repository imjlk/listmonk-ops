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

/**
 * Safety precedence is intentionally conservative:
 * suppression requires a preview and confirmation; delivery and deletion
 * require confirmation; ordinary writes are audited; pure reads need neither.
 * Higher tiers win when an operation declares more than one effect.
 */
export type PolicyForEffects<
	Effects extends readonly OperationEffect[],
> = HasEffect<Effects, "suppression"> extends true
	? {
			confirmation: "required";
			audit: "required";
			dryRun: true;
		}
	: HasEffect<Effects, "delivery" | "delete"> extends true
		? {
				confirmation: "required";
				audit: "required";
				dryRun: false;
			}
		: HasEffect<Effects, "write"> extends true
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
	if (hasEffectKind(effects, ["delivery", "delete"])) {
		return {
			confirmation: "required",
			audit: "required",
			dryRun: false,
		};
	}
	if (hasEffectKind(effects, ["write"])) {
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
