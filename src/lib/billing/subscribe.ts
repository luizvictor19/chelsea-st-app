/**
 * Starting and ending a subscription, as the plan screen asks. Pure of
 * Next and of Supabase: the provider and the store come in, so every path is
 * tested with the fakes.
 *
 * Starting (the #72 plan, "Entrada"):
 * - the CPF is checked and kept as an HMAC; one person per CPF, one CPF per
 *   person, one trial per person (Q4);
 * - the trial is the plan's days when she has not had one, none otherwise;
 *   the first charge is the day of the subscription plus those days;
 * - card: the hosted checkout (Q1), where the card is typed; the row waits
 *   there as pending until the provider makes the subscription;
 * - Pix: the provider's customer and subscription at once, the row trialing
 *   (or active with no trial), the first charge read and kept.
 */

import { cpfDigits, cpfHmac, isValidCpf } from "./cpf.ts";
import { firstDueOn } from "./dates.ts";
import { SUBSCRIBE_REFUSALS } from "./messages.ts";
import type { BillingProvider, Cycle } from "./provider.ts";
import {
  StoreRefusal,
  type BillingStore,
  type StoredSubscription,
} from "./store.ts";
import { syncSubscription, type SyncDeps } from "./sync.ts";

/** How long the hosted checkout waits, in minutes (10 to 1440 at Asaas). */
export const CHECKOUT_MINUTES = 60;

export type PlanForSale = {
  readonly id: string;
  readonly name: string;
  readonly monthlyPriceCents: number;
  readonly annualPriceCents: number;
  readonly trialDays: number;
};

export type StartResult =
  | { readonly kind: "checkout"; readonly url: string }
  | { readonly kind: "pix"; readonly rowId: string }
  | { readonly kind: "refused"; readonly message: string };

export function priceOf(plan: PlanForSale, cycle: Cycle): number {
  return cycle === "monthly" ? plan.monthlyPriceCents : plan.annualPriceCents;
}

function refusal(cause: unknown): StartResult | null {
  if (!(cause instanceof StoreRefusal)) return null;
  const message = SUBSCRIBE_REFUSALS[cause.constraint];
  return message === undefined ? null : { kind: "refused", message };
}

export async function startSubscription(
  deps: SyncDeps,
  input: {
    personId: string;
    name: string;
    email: string;
    cpf: string;
    plan: PlanForSale;
    cycle: Cycle;
    billingType: "card" | "pix";
    today: string;
    returnUrl: string;
  },
): Promise<StartResult> {
  const { provider, store } = deps;
  if (!isValidCpf(input.cpf)) {
    return { kind: "refused", message: SUBSCRIBE_REFUSALS.invalid_cpf };
  }
  if (input.name.trim().length < 2) {
    return { kind: "refused", message: SUBSCRIBE_REFUSALS.invalid_name };
  }

  let trialUsedAt: string | null;
  try {
    trialUsedAt = await store.customer(
      input.personId,
      cpfHmac(input.cpf, deps.cpfKey),
    );
  } catch (cause) {
    const refused = refusal(cause);
    if (refused !== null) return refused;
    throw cause;
  }

  const withTrial = trialUsedAt === null && input.plan.trialDays > 0;
  const firstDue = firstDueOn(
    input.today,
    withTrial ? input.plan.trialDays : 0,
  );
  const valueCents = priceOf(input.plan, input.cycle);
  const common = {
    personId: input.personId,
    planId: input.plan.id,
    cycle: input.cycle,
    valueCents,
    withTrial,
    firstDueOn: firstDue,
  };

  if (input.billingType === "card") {
    const checkout = await provider.createCardCheckout({
      itemName: input.plan.name,
      valueCents,
      cycle: input.cycle,
      firstDueOn: firstDue,
      reference: input.personId,
      returnUrl: input.returnUrl,
      minutesToExpire: CHECKOUT_MINUTES,
    });
    try {
      await store.openSubscription({
        ...common,
        billingType: "card",
        checkoutId: checkout.id,
        customerId: null,
        subscriptionId: null,
      });
    } catch (cause) {
      // The checkout left behind expires by itself, unpaid.
      const refused = refusal(cause);
      if (refused !== null) return refused;
      throw cause;
    }
    return { kind: "checkout", url: checkout.url };
  }

  const customer = await provider.createCustomer({
    name: input.name.trim(),
    cpf: cpfDigits(input.cpf) ?? input.cpf,
    email: input.email,
    reference: input.personId,
  });
  const subscription = await provider.createPixSubscription({
    customerId: customer.id,
    valueCents,
    cycle: input.cycle,
    firstDueOn: firstDue,
    description: input.plan.name,
    reference: input.personId,
  });
  let rowId: string;
  try {
    rowId = await store.openSubscription({
      ...common,
      billingType: "pix",
      checkoutId: null,
      customerId: customer.id,
      subscriptionId: subscription.id,
    });
  } catch (cause) {
    // The provider holds a subscription the database refused: undo it, so
    // nobody is charged for a row that does not exist.
    await provider.deleteSubscription(subscription.id);
    const refused = refusal(cause);
    if (refused !== null) return refused;
    throw cause;
  }
  const row = await store.findSubscription({ subscriptionId: subscription.id });
  if (row !== null) await syncSubscription(deps, row, subscription.id);
  return { kind: "pix", rowId };
}

/**
 * Ends her subscription. At the provider the charges not yet paid go with
 * it, so nothing more is charged; what was paid stays paid, and the screen
 * keeps her access to the end of the paid cycle (paid_through).
 */
export async function cancelSubscription(
  deps: { provider: BillingProvider; store: BillingStore },
  row: StoredSubscription,
): Promise<void> {
  if (row.status === "canceled") return;
  if (row.asaasSubscriptionId !== null) {
    await deps.provider.deleteSubscription(row.asaasSubscriptionId);
  }
  await deps.store.applySubscription(row.id, {
    subscriptionId: null,
    customerId: null,
    status: "canceled",
    paidThrough: null,
    pastDueSince: null,
    cancelReason: "person",
  });
}

/** The Pix of the charge she has to pay now, or null when there is none. */
export async function pixToPay(
  provider: BillingProvider,
  row: StoredSubscription,
): Promise<{ payload: string; imageBase64: string; dueOn: string } | null> {
  if (row.billingType !== "pix" || row.asaasSubscriptionId === null)
    return null;
  const payments = await provider.listSubscriptionPayments(
    row.asaasSubscriptionId,
  );
  const open = payments
    .filter(
      (payment) =>
        !payment.deleted &&
        (payment.status === "PENDING" || payment.status === "OVERDUE"),
    )
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0];
  if (open === undefined) return null;
  const code = await provider.getPixCode(open.id);
  return { ...code, dueOn: open.dueOn };
}
