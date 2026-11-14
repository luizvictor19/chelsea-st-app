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

  // From here the refund is at the provider. Each step below is best
  // effort: a failure is logged and the daily routine finishes it, because
  // a second click would be refused (one open) and "try again" would be
  // false. The answer to her comes from the provider's own answer.
  const taken = statusOf(payment, opened.refundCents);
  if (taken === null) {
    // Answered without a refund of this value on its way: canceled at once,
    // or not listed yet. The database decides; the routine reads it later.
    const status = await bestEffort(deps, opened.id, "reading", () =>
      store.refundReading(payment.id, payment.refunds),
    );
    return status === "failed"
      ? { kind: "refused", message: REFUND_REFUSALS.provider_refused }
      : { kind: "pending" };
  }
  await bestEffort(deps, opened.id, "reading", () =>
    store.refundReading(payment.id, payment.refunds),
  );

  const row = input.current;
  if (row !== null && row.id === opened.subscriptionId) {
    if (row.status !== "canceled") {
      await bestEffort(deps, opened.id, "cancel", () =>
        cancelSubscription(deps, row),
      );
    }
    // The charge written now, with the money back when it is already DONE:
    // the void runs, and only then the request ends (#302, 0060).
    const subscriptionId = row.asaasSubscriptionId;
    if (subscriptionId !== null) {
      await bestEffort(deps, opened.id, "sync", async () => {
        const after = await store.findSubscription({ subscriptionId });
        if (after !== null) await syncSubscription(deps, after, subscriptionId);
      });
    }
  }

  if (taken !== "DONE") {
    await bestEffort(deps, opened.id, "notice", () =>
      deps.notify(opened.paymentId),
    );
    return { kind: "sent" };
  }
  return { kind: "done" };
}

/** A step after the refund was taken: logged when it fails, never thrown. */
async function bestEffort<T>(
  deps: { readonly log: (line: string) => void },
  id: string,
  what: string,
  run: () => Promise<T>,
): Promise<T | null> {
  try {
    return await run();
  } catch (cause) {
    deps.log(
      `refund ${id}: ${what} failed, left to the routine: ${String(cause)}`,
    );
    return null;
  }
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
 * the charge refunded is written and its credits voided, and only then does
 * a refund DONE end the request.
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
        if (row !== null && row.status !== "canceled" && status === "sent") {
          await cancelSubscription(deps, row);
        }
        // Writes the charge and settles it, then reads its refunds again:
        // a refund DONE ends the request only after the void.
        const after = await find();
        if (after !== null) {
          await syncSubscription(deps, after, open.asaasSubscriptionId);
        }
      }
      const final =
        (await store.refundReading(open.paymentId, payment.refunds)) ??
        (status === "failed" ? "failed" : "done");
      if (final === "done") counts.done += 1;
      else if (final === "failed") counts.failed += 1;
      else counts.waiting += 1;
    } catch (cause) {
      counts.errors += 1;
      deps.log(`refund ${open.id}: could not be read: ${String(cause)}`);
    }
  }
  return counts;
}
