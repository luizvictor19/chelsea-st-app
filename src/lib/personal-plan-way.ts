/**
 * The way to the checkout of a Plano Fundador Personalizado (#292): the
 * e-mail of the plan carries no "next" (the confirmation e-mail of the
 * signup carries only the origin), so the front door sends her there, after
 * the login, after "Definir senha" and on any visit to "/", while the plan
 * waits for her.
 *
 * Pure on purpose: node:test runs this file as plain TypeScript. The reads
 * are resolveDestination's, in src/lib/auth.ts.
 */

/** A subscription that holds the door: running, not a checkout left open. */
const ALIVE = new Set(["trialing", "awaiting", "active", "past_due"]);

export function pendingPersonalPlan(input: {
  /** Where she would go otherwise (destinationFor). */
  readonly destination: string;
  /** Her personal plans, newest first, as row level security gives them. */
  readonly plans: readonly {
    readonly id: string;
    readonly isActive: boolean;
  }[];
  readonly subscriptionStatuses: readonly string[];
}): `/dashboard/plano?plano=${string}` | null {
  if (input.destination !== "/dashboard") return null;
  if (input.subscriptionStatuses.some((status) => ALIVE.has(status))) {
    return null;
  }
  const plan = input.plans.find((each) => each.isActive);
  return plan === undefined
    ? null
    : `/dashboard/plano?plano=${encodeURIComponent(plan.id)}`;
}
