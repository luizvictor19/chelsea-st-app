/**
 * What a subscription is, read from what the provider holds now. Never from
 * the body of an event (#72 plan): the webhook only says that something
 * changed, the app asks the provider what, and this decides what it means.
 * Because the answer depends only on the provider's present state, an event
 * that arrives late or twice cannot leave a wrong state behind.
 */

import { paidThroughOf } from "./dates.ts";
import {
  PAID_STATUSES,
  type Cycle,
  type ProviderPayment,
  type ProviderSubscription,
} from "./provider.ts";

export type SubscriptionStatus =
  "pending" | "trialing" | "active" | "past_due" | "canceled";

export type Reading = {
  readonly status: Exclude<SubscriptionStatus, "pending">;
  /** The last day the paid charges cover; null when none is paid. */
  readonly paidThrough: string | null;
  /** The due day of the oldest unpaid charge past due; null when none. */
  readonly pastDueSince: string | null;
};

/**
 * The reading of a subscription the provider holds.
 *
 *   canceled   the provider deleted it or no longer runs it.
 *   past_due   a charge of it is overdue (the routine works on it, Q5).
 *   active     a charge of it is paid, or there is no trial to be in.
 *   trialing   it has a trial and no charge of it is paid yet: before the
 *              first due day, and on that day until the charge confirms.
 */
export function readSubscription(input: {
  withTrial: boolean;
  cycle: Cycle;
  subscription: ProviderSubscription;
  payments: readonly ProviderPayment[];
}): Reading {
  const { subscription, payments, cycle, withTrial } = input;
  const live = payments.filter(
    (payment) =>
      !payment.deleted &&
      (payment.subscriptionId === null ||
        payment.subscriptionId === subscription.id),
  );

  const paidDays = live
    .filter((payment) => PAID_STATUSES.has(payment.status))
    .map((payment) => payment.dueOn)
    .sort();
  const paidThrough =
    paidDays.length === 0
      ? null
      : paidThroughOf(paidDays[paidDays.length - 1], cycle);

  if (subscription.deleted || subscription.status !== "ACTIVE") {
    return { status: "canceled", paidThrough, pastDueSince: null };
  }

  const overdueDays = live
    .filter((payment) => payment.status === "OVERDUE")
    .map((payment) => payment.dueOn)
    .sort();
  if (overdueDays.length > 0) {
    return { status: "past_due", paidThrough, pastDueSince: overdueDays[0] };
  }
  if (paidThrough !== null || !withTrial) {
    return { status: "active", paidThrough, pastDueSince: null };
  }
  return { status: "trialing", paidThrough: null, pastDueSince: null };
}
