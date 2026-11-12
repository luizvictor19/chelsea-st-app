/**
 * The provider's webhook, as a function of what arrived and what it can
 * reach, so every answer can be tested without a server.
 *
 * Asaas (docs read 12/11/2026): the shared token comes in the
 * asaas-access-token header; an event comes at least once, with the same id
 * on every delivery; only a 200 counts as delivered; the call times out in
 * 10 s; after 15 failures in a row the queue stops. So:
 *
 * - wrong or missing token: 401, nothing read;
 * - an event already finished: 200 at once;
 * - an event that cannot be read, or about something that is not ours: kept
 *   with the reason and answered 200, so it never counts towards the 15;
 * - a passing failure (the provider or the database out): 500 and nothing
 *   finished, so the redelivery handles it again.
 *
 * The body says only that something changed. What changed is read back from
 * the provider (sync.ts), so a forged or late body cannot set the state.
 */

import { timingSafeEqual } from "node:crypto";

import { ProviderError } from "./provider.ts";
import type { BillingStore } from "./store.ts";
import { syncSubscription, type SyncDeps } from "./sync.ts";

export type WebhookResult = {
  readonly status: 200 | 401 | 500;
  readonly note: string;
};

export type WebhookDeps = SyncDeps & {
  readonly token: string;
  readonly log: (line: string) => void;
};

function sameSecret(given: string | null, expected: string): boolean {
  if (given === null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** A failure the next delivery may not meet: the provider or the database. */
function isPassing(cause: unknown): boolean {
  if (cause instanceof ProviderError) {
    return cause.status >= 500 || cause.status === 429;
  }
  // A timeout, a dropped connection, the database refusing: all passing.
  return true;
}

class NotOurs extends Error {}

async function handle(
  deps: WebhookDeps,
  event: string,
  body: Record<string, unknown>,
): Promise<string> {
  const store: BillingStore = deps.store;

  if (event.startsWith("CHECKOUT_")) {
    const checkout = record(body.checkout);
    const checkoutId = text(checkout.id);
    if (checkoutId === null)
      throw new NotOurs("checkout event without a checkout id");
    const row = await store.findSubscription({ checkoutId });
    if (row === null) throw new NotOurs(`unknown checkout ${checkoutId}`);
    if (
      (event === "CHECKOUT_EXPIRED" || event === "CHECKOUT_CANCELED") &&
      row.status === "pending"
    ) {
      await store.applySubscription(row.id, {
        subscriptionId: null,
        customerId: null,
        status: "canceled",
        paidThrough: null,
        pastDueSince: null,
        cancelReason: "checkout_expired",
      });
      return `checkout ${checkoutId} ended unfinished`;
    }
    // CHECKOUT_PAID and CREATED: the subscription the checkout made arrives
    // with its own event, SUBSCRIPTION_CREATED.
    return `checkout ${checkoutId}: nothing to do`;
  }

  let subscriptionId: string | null = null;
  if (event.startsWith("PAYMENT_")) {
    subscriptionId = text(record(body.payment).subscription);
    if (subscriptionId === null) {
      // A charge with no subscription: an upgrade or a pack (#273, #274).
      throw new NotOurs("charge without a subscription");
    }
  } else if (event.startsWith("SUBSCRIPTION_")) {
    subscriptionId = text(record(body.subscription).id);
  }
  if (subscriptionId === null)
    throw new NotOurs(`event ${event} names no subscription`);

  let row = await store.findSubscription({ subscriptionId });
  if (row === null) {
    // A card subscription is known by its checkout until here.
    const subscription = await deps.provider.getSubscription(subscriptionId);
    if (subscription.checkoutId !== null) {
      row = await store.findSubscription({
        checkoutId: subscription.checkoutId,
      });
    }
  }
  if (row === null) throw new NotOurs(`unknown subscription ${subscriptionId}`);

  await syncSubscription(deps, row, subscriptionId);
  return `subscription ${subscriptionId} read`;
}

export async function handleWebhook(
  deps: WebhookDeps,
  request: { tokenHeader: string | null; body: string },
): Promise<WebhookResult> {
  if (!sameSecret(request.tokenHeader, deps.token)) {
    return { status: 401, note: "wrong token" };
  }

  let body: Record<string, unknown>;
  try {
    body = record(JSON.parse(request.body));
  } catch {
    deps.log("asaas webhook: a body that is not JSON");
    return { status: 200, note: "not JSON" };
  }
  const id = text(body.id);
  const event = text(body.event);
  if (id === null || event === null) {
    deps.log("asaas webhook: an event without id or name");
    return { status: 200, note: "no id" };
  }

  let open: boolean;
  try {
    open = await deps.store.recordEvent(id, event, body);
  } catch (cause) {
    deps.log(
      `asaas webhook ${id} ${event}: could not be kept: ${String(cause)}`,
    );
    return { status: 500, note: "store down" };
  }
  if (!open) return { status: 200, note: "already handled" };

  try {
    const note = await handle(deps, event, body);
    await deps.store.finishEvent(id, null);
    return { status: 200, note };
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    if (cause instanceof NotOurs || !isPassing(cause)) {
      deps.log(`asaas webhook ${id} ${event}: set aside: ${reason}`);
      try {
        await deps.store.finishEvent(id, reason.slice(0, 500));
      } catch (finishCause) {
        deps.log(
          `asaas webhook ${id}: could not be finished: ${String(finishCause)}`,
        );
        return { status: 500, note: "store down" };
      }
      return { status: 200, note: `set aside: ${reason}` };
    }
    deps.log(
      `asaas webhook ${id} ${event}: will be delivered again: ${reason}`,
    );
    return { status: 500, note: `passing failure: ${reason}` };
  }
}
