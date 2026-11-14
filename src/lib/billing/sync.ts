/**
 * Bringing one subscription up to date: read it and its charges from the
 * provider, write what they mean. The webhook, the routine and the screen
 * all end here, so the state has one way in.
 */

import { cpfHmac, isValidCpf } from "./cpf.ts";
import {
  PAID_STATUSES,
  type BillingProvider,
  type ProviderPayment,
} from "./provider.ts";
import { readSubscription } from "./state.ts";
import {
  StoreRefusal,
  type BillingStore,
  type StoredSubscription,
} from "./store.ts";

export type SyncDeps = {
  readonly provider: BillingProvider;
  readonly store: BillingStore;
  readonly cpfKey: string;
};

/**
 * Whether the CPF typed at the checkout is the one she declared before it.
 * Her trial was granted on the declared CPF; a different one at the checkout
 * would be a second trial on a second CPF (Q4).
 */
async function sameCpf(
  deps: SyncDeps,
  row: StoredSubscription,
  customerId: string,
): Promise<boolean> {
  const customer = await deps.provider.getCustomer(customerId);
  if (customer.cpf === null || !isValidCpf(customer.cpf)) return false;
  try {
    await deps.store.customer(row.personId, cpfHmac(customer.cpf, deps.cpfKey));
    return true;
  } catch (cause) {
    if (
      cause instanceof StoreRefusal &&
      (cause.constraint === "billing_customers_one_cpf_per_person" ||
        cause.constraint === "billing_customers_one_person_per_cpf")
    ) {
      return false;
    }
    throw cause;
  }
}

export async function syncSubscription(
  deps: SyncDeps,
  row: StoredSubscription,
  providerSubscriptionId: string,
): Promise<void> {
  const { provider, store } = deps;
  const subscription = await provider.getSubscription(providerSubscriptionId);
  const running = !subscription.deleted && subscription.status === "ACTIVE";

  if (row.status === "canceled") {
    // A canceled row never has a subscription running behind it. One that
    // runs came from a checkout left open after the row was canceled (by
    // her, or replaced by another subscription) and finished later: undo it,
    // and give back what it already charged (review of #72, finding 1).
    if (running) {
      const charges = await provider.listSubscriptionPayments(subscription.id);
      for (const charge of charges) {
        if (
          !charge.deleted &&
          PAID_STATUSES.has(charge.status) &&
          charge.refundedCents < charge.valueCents
        ) {
          await provider.refund(charge.id);
        }
      }
      await provider.deleteSubscription(subscription.id);
      return;
    }
    // A subscription this row ran with (#302): its charges are still read
    // and written after the cancel, so a charge refunded later (the refund of
    // CDC art. 49 comes after the cancel) voids its credits. The row stays
    // canceled: nothing here writes the subscription. A subscription undone
    // above never ran with the row (a pending row knows it by its checkout
    // only), so none of its charges is written and none grants.
    if (row.asaasSubscriptionId === subscription.id) {
      const payments = await provider.listSubscriptionPayments(subscription.id);
      await writePayments(deps, row, payments);
      await readRefunds(deps, payments);
      await settlePayments(deps, payments);
    }
    return;
  }

  if (row.status === "pending" && row.withTrial && running) {
    if (!(await sameCpf(deps, row, subscription.customerId))) {
      // Nothing was charged yet: the first charge falls at the end of the
      // trial. Deleting the subscription takes that charge with it.
      await provider.deleteSubscription(subscription.id);
      await store.applySubscription(row.id, {
        subscriptionId: subscription.id,
        customerId: subscription.customerId,
        status: "canceled",
        paidThrough: null,
        pastDueSince: null,
        cancelReason: "trial_used",
      });
      return;
    }
  }

  const payments = await provider.listSubscriptionPayments(subscription.id);
  await writePayments(deps, row, payments);
  await readRefunds(deps, payments);

  const reading = readSubscription({
    withTrial: row.withTrial,
    cycle: row.cycle,
    subscription,
    payments,
  });
  await store.applySubscription(row.id, {
    subscriptionId: subscription.id,
    customerId: subscription.customerId,
    ...reading,
    cancelReason: reading.status === "canceled" ? "provider" : null,
  });

  await settlePayments(deps, payments);
}

/** Every charge read, written as the provider holds it now. */
async function writePayments(
  deps: SyncDeps,
  row: StoredSubscription,
  payments: readonly ProviderPayment[],
): Promise<void> {
  // Side by side, not one after another: the webhook has 10 s in all.
  await Promise.all(
    payments.map((payment) =>
      deps.store.savePayment({
        paymentId: payment.id,
        subscriptionId: row.id,
        valueCents: payment.valueCents,
        asaasStatus: payment.status,
        deleted: payment.deleted,
        dueOn: payment.dueOn,
        paidAt: payment.paidOn,
        refundedCents: payment.refundedCents,
        invoiceUrl: payment.invoiceUrl,
      }),
    ),
  );
}

/**
 * What the provider holds of each charge's refunds, over its open
 * withdrawal (#297, 0060): done, waiting or canceled. The database decides;
 * a charge with no refund asked has nothing to say.
 */
async function readRefunds(
  deps: SyncDeps,
  payments: readonly ProviderPayment[],
): Promise<void> {
  await Promise.all(
    payments
      .filter((payment) => payment.refunds.length > 0)
      .map((payment) => deps.store.refundReading(payment.id, payment.refunds)),
  );
}

/**
 * What each charge read means for the credits (#273), every charge, paid or
 * not, once it is written: the database reads the charge it just kept and
 * grants the month a paid one is in (once by charge and month), voids what a
 * refunded or deleted one left, or does nothing. Never from the body of the
 * event. Each call takes the person's lock in the database, so side by side
 * is safe.
 */
async function settlePayments(
  deps: SyncDeps,
  payments: readonly ProviderPayment[],
): Promise<void> {
  await Promise.all(
    payments.map((payment) => deps.store.settleCredits(payment.id)),
  );
}
