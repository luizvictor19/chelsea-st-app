/**
 * The withdrawal of CDC art. 49 (#297): she gives up the subscription within
 * the 7 days and gets back, in money, what she did not use. Pure of Next and
 * of Supabase: the provider and the store come in, so every path is tested
 * with the fakes.
 *
 * The order (the plan approved on 14/11):
 * 1. the database reserves the request, with its value (0060): a second
 *    click, or an answer lost on the way, never asks for two refunds, and
 *    nothing of hers is spent until it ends;
 * 2. the provider is asked for that value;
 * 3. only with the refund taken is the subscription canceled, so a refund
 *    refused never leaves her without plan and without money;
 * 4. while the refund waits for the panel (the critical event, Q3 A), the
 *    brand's contact gets a notice.
 *
 * The refund counts as done only when the provider says DONE; the webhook
 * then writes the charge (#302) and the database voids what was left (0050).
 * An answer lost (a timeout, a 5xx) leaves the request requested, and the
 * daily routine (reconcileRefunds) reads the charge before deciding: the
 * provider asks to check before repeating a refund.
 */

import { REFUND_DESCRIPTION, REFUND_REFUSALS } from "./messages.ts";
import { ProviderError, type ProviderPayment } from "./provider.ts";
import { StoreRefusal, type StoredSubscription } from "./store.ts";
import { cancelSubscription } from "./subscribe.ts";
import { syncSubscription, type SyncDeps } from "./sync.ts";

/** How long a request may stay requested before the routine reads it. */
export const REFUND_SETTLE_MINUTES = 30;

export type WithdrawDeps = SyncDeps & {
  /** The notice while the refund waits for the panel. */
  readonly notify: (paymentId: string) => Promise<void>;
  readonly log: (line: string) => void;
};

export type WithdrawResult =
  | { readonly kind: "refused"; readonly message: string }
  /** Taken by the provider: done already, or waiting there. */
  | { readonly kind: "sent" | "done" }
  /** The provider's answer was lost: the routine reads it later. */
  | { readonly kind: "pending" };

/** A refusal the next try meets again: a 4xx of the provider, not a 429. */
function refusedForGood(cause: unknown): cause is ProviderError {
  return (
    cause instanceof ProviderError &&
    cause.status >= 400 &&
    cause.status < 500 &&
    cause.status !== 429
  );
}

/** The status of the refund of this value the provider answered, if any. */
function statusOf(payment: ProviderPayment, cents: number): string | null {
  return (
    payment.refunds.find(
      (refund) => refund.valueCents === cents && refund.status !== "CANCELLED",
    )?.status ?? null
  );
}

export async function withdraw(
  deps: WithdrawDeps,
  input: {
    readonly personId: string;
    /** Her latest subscription, as the plan screen read it. */
    readonly current: StoredSubscription | null;
  },
): Promise<WithdrawResult> {
  const { provider, store } = deps;

  let opened;
  try {
    opened = await store.openRefund(input.personId);
  } catch (cause) {
    if (cause instanceof StoreRefusal) {
      const message = REFUND_REFUSALS[cause.constraint];
      if (message !== undefined) return { kind: "refused", message };
    }
    throw cause;
  }

  let payment: ProviderPayment;
  try {
    payment = await provider.refund(
      opened.paymentId,
      opened.refundCents,
      REFUND_DESCRIPTION,
    );
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    if (refusedForGood(cause)) {
      await store.refundFailed(opened.id, reason);
      deps.log(`refund ${opened.id}: refused by the provider: ${reason}`);
      return { kind: "refused", message: REFUND_REFUSALS.provider_refused };
    }
    deps.log(`refund ${opened.id}: answer lost, left requested: ${reason}`);
    return { kind: "pending" };
  }

  await store.refundSent(opened.id, statusOf(payment, opened.refundCents));
  const status =
    (await store.refundReading(payment.id, payment.refunds)) ?? "sent";
  if (status !== "sent" && status !== "done") {
    // The provider took it and canceled it at once: nothing came back.
    return { kind: "refused", message: REFUND_REFUSALS.provider_refused };
  }

  const row = input.current;
  if (
    row !== null &&
    row.id === opened.subscriptionId &&
    row.status !== "canceled"
  ) {
    try {
      await cancelSubscription(deps, row);
    } catch (cause) {
      // The refund is on its way; the routine cancels what is left.
      deps.log(`refund ${opened.id}: cancel failed: ${String(cause)}`);
    }
  }

  if (status === "sent") {
    try {
      await deps.notify(opened.paymentId);
    } catch (cause) {
      deps.log(`refund ${opened.id}: notice failed: ${String(cause)}`);
    }
  }
  return { kind: status };
}

export type RefundReport = {
  readonly read: number;
  readonly done: number;
  readonly failed: number;
  readonly waiting: number;
  readonly errors: number;
};

/**
 * The daily step of the withdrawals: every request still open is read back
 * from the provider. A refund of its value done or waiting moves it, and the
 * subscription is canceled if it is still alive; a request with no refund of
 * its value at the provider after REFUND_SETTLE_MINUTES never reached it, and
 * fails, so she may spend and ask again. Then the subscription is read, so
 * the charge refunded is written and its credits voided.
 */
export async function reconcileRefunds(
  deps: SyncDeps & {
    readonly now: Date;
    readonly log: (line: string) => void;
  },
): Promise<RefundReport> {
  const { provider, store } = deps;
  const counts = { read: 0, done: 0, failed: 0, waiting: 0, errors: 0 };
  for (const open of await store.openRefunds()) {
    const age = deps.now.getTime() - Date.parse(open.createdAt);
    if (open.status === "requested" && age < REFUND_SETTLE_MINUTES * 60_000) {
      continue;
    }
    try {
      counts.read += 1;
      const payment = await provider.getPayment(open.paymentId);
      let status =
        (await store.refundReading(open.paymentId, payment.refunds)) ??
        open.status;
      if (status === "requested") {
        status = await store.refundFailed(
          open.id,
          "no refund of this value at the provider",
        );
      }
      if (open.asaasSubscriptionId !== null) {
        const find = () =>
          store.findSubscription({ subscriptionId: open.asaasSubscriptionId });
        const row = await find();
        if (
          row !== null &&
          row.status !== "canceled" &&
          (status === "sent" || status === "done")
        ) {
          await cancelSubscription(deps, row);
        }
        const after = await find();
        if (after !== null) {
          await syncSubscription(deps, after, open.asaasSubscriptionId);
        }
      }
      if (status === "done") counts.done += 1;
      else if (status === "failed") counts.failed += 1;
      else counts.waiting += 1;
    } catch (cause) {
      counts.errors += 1;
      deps.log(`refund ${open.id}: could not be read: ${String(cause)}`);
    }
  }
  return counts;
}
