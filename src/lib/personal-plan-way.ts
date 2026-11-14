/**
 * The way to the checkout of a Plano Fundador Personalizado (#292): the
 * e-mail of the plan carries no "next" (the confirmation e-mail of the
 * signup carries only the origin), so the front door sends her there, after
 * the login, after "Definir senha" and on any visit to "/", while the plan
 * waits for her: on sale, no subscription of hers alive, and none of that
 * plan ever ran. Once she subscribed to it, cancelling it does not bring her
 * back here on every visit.
 *
 * Pure on purpose: node:test runs this file as plain TypeScript. The reads
 * are resolveDestination's, in src/lib/auth.ts.
 */

/** A subscription that holds the door: running, not a checkout left open. */
const ALIVE = new Set(["trialing", "awaiting", "active", "past_due"]);

/** Cancels of a subscription that never ran (credit_deadline, 0050). */
const NEVER_RAN = new Set(["replaced", "checkout_expired", "trial_used"]);

export type HerSubscription = {
  readonly planId: string;
  readonly status: string;
  readonly cancelReason: string | null;
};

export function pendingPersonalPlan(input: {
  /** Where she would go otherwise (destinationFor). */
  readonly destination: string;
  /** Whether the subscription is open at all (billingOpen). */
  readonly billingOpen: boolean;
  /** Her personal plans, newest first, as row level security gives them. */
  readonly plans: readonly {
    readonly id: string;
    readonly isActive: boolean;
  }[];
  readonly subscriptions: readonly HerSubscription[];
}): `/dashboard/plano?plano=${string}` | null {
  if (input.destination !== "/dashboard" || !input.billingOpen) return null;
  if (input.subscriptions.some((sub) => ALIVE.has(sub.status))) return null;
  const ran = (planId: string) =>
    input.subscriptions.some(
      (sub) =>
        sub.planId === planId &&
        sub.status === "canceled" &&
        !NEVER_RAN.has(sub.cancelReason ?? ""),
    );
  const plan = input.plans.find((each) => each.isActive && !ran(each.id));
  return plan === undefined
    ? null
    : `/dashboard/plano?plano=${encodeURIComponent(plan.id)}`;
}
