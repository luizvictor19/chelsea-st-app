/**
 * The daily routine on charges past due (Luiz, Q5 of the #72 plan, 12/11):
 * seven days overdue, without canceling; a new charge and an e-mail on days
 * 1, 3, 5 and 7; on day 7 with no payment, the subscription is canceled and a
 * last e-mail says so.
 *
 * Day 1 is the first day after the due day. The routine runs once a day
 * (Vercel Cron), and a day it misses is not lost: it takes the latest step
 * due that it has not taken yet. Each step of a charge is claimed once in the
 * database before anything is done, so a routine that runs twice neither
 * charges nor writes twice.
 *
 * Card: the charge is paid again with the card saved for it. Pix: nothing
 * can be charged, the person pays; the step is the e-mail with the link.
 */

import { daysBetween } from "./dates.ts";
import type { Mailer } from "../mail/mailer.ts";
import { overdueEmail } from "./messages.ts";
import { PAID_STATUSES, type BillingProvider } from "./provider.ts";
import {
  OVERDUE_DAYS,
  type BillingStore,
  type OverdueDay,
  type OverdueOutcome,
  type OverduePayment,
} from "./store.ts";

export const LAST_OVERDUE_DAY: OverdueDay = 7;

/** The step due on this day of the overdue, or null before day 1. */
export function overdueStep(dueOn: string, today: string): OverdueDay | null {
  const days = daysBetween(dueOn, today);
  let step: OverdueDay | null = null;
  for (const day of OVERDUE_DAYS) if (day <= days) step = day;
  return step;
}

export type OverdueDeps = {
  readonly provider: BillingProvider;
  readonly store: BillingStore;
  readonly mailer: Mailer;
  readonly today: string;
  readonly emailOf: (personId: string) => Promise<string | null>;
  readonly appUrl: string;
  readonly log: (line: string) => void;
};

export type OverdueReport = {
  readonly taken: number;
  readonly outcomes: Readonly<Record<string, number>>;
};

async function takeStep(
  deps: OverdueDeps,
  overdue: OverduePayment,
  day: OverdueDay,
): Promise<{ outcome: OverdueOutcome; emailed: boolean }> {
  const { provider, store } = deps;
  let payment = await provider.getPayment(overdue.paymentId);
  const last = day === LAST_OVERDUE_DAY;
  if (PAID_STATUSES.has(payment.status) || (payment.deleted && !last)) {
    // Paid or gone since the last reading; the webhook brings the state.
    return { outcome: "already_paid", emailed: false };
  }
  // Gone on day 7: a run before deleted it at the provider and failed after
  // (review of #72, finding 2). The cancel here still has to happen.

  let outcome: OverdueOutcome = "pix_reminder";
  if (overdue.billingType === "card" && !payment.deleted) {
    outcome = "refused";
    if (payment.cardToken !== null) {
      try {
        payment = await provider.payWithCardToken(
          payment.id,
          payment.cardToken,
        );
        if (PAID_STATUSES.has(payment.status))
          return { outcome: "paid", emailed: false };
      } catch (cause) {
        deps.log(
          `overdue ${payment.id} day ${day}: card refused: ${String(cause)}`,
        );
      }
    }
  }

  if (last) {
    if (!payment.deleted && payment.subscriptionId !== null) {
      await provider.deleteSubscription(payment.subscriptionId);
    }
    await store.applySubscription(overdue.subscriptionId, {
      subscriptionId: null,
      customerId: null,
      status: "canceled",
      paidThrough: null,
      pastDueSince: null,
      cancelReason: "overdue",
    });
    outcome = "canceled";
  }

  const to = await deps.emailOf(overdue.personId);
  if (to === null) return { outcome, emailed: false };
  await deps.mailer.send({
    to,
    ...overdueEmail({
      day,
      lastDay: LAST_OVERDUE_DAY,
      billingType: overdue.billingType,
      canceled: outcome === "canceled",
      invoiceUrl: payment.invoiceUrl ?? overdue.invoiceUrl,
      planUrl: `${deps.appUrl}/dashboard/plano`,
    }),
  });
  return { outcome, emailed: true };
}

export async function runOverdue(deps: OverdueDeps): Promise<OverdueReport> {
  const outcomes: Record<string, number> = {};
  let taken = 0;
  for (const overdue of await deps.store.overduePayments()) {
    const day = overdueStep(overdue.dueOn, deps.today);
    if (day === null) continue;
    if (!(await deps.store.takeOverdueStep(overdue.paymentId, day))) continue;
    taken++;
    let result: { outcome: OverdueOutcome; emailed: boolean };
    try {
      result = await takeStep(deps, overdue, day);
    } catch (cause) {
      deps.log(`overdue ${overdue.paymentId} day ${day}: ${String(cause)}`);
      result = { outcome: "error", emailed: false };
    }
    await deps.store.finishOverdueStep(
      overdue.paymentId,
      day,
      result.outcome,
      result.emailed,
    );
    outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
  }
  return { taken, outcomes };
}
