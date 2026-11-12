import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { cpfHmac } from "./cpf.ts";
import {
  createFakeProvider,
  createFakeStore,
  finishCheckout,
  setPayment,
  type FakeProvider,
  type FakeStore,
} from "./fake.ts";
import { ProviderError } from "./provider.ts";
import { StoreError, StoreRefusal } from "./store.ts";
import { handleWebhook, type WebhookDeps } from "./webhook.ts";

const TOKEN = "t".repeat(64);
const KEY = "k".repeat(64);
const CPF = "52998224725";
const OTHER_CPF = "11144477735";
const PERSON = "person-1";

let provider: FakeProvider;
let store: FakeStore;
let confirmed: string[];
let logged: string[];

function deps(): WebhookDeps {
  return {
    provider,
    store,
    cpfKey: KEY,
    token: TOKEN,
    log: (line) => logged.push(line),
    onPaymentConfirmed: async (paymentId) => {
      confirmed.push(paymentId);
    },
  };
}

let eventNumber = 0;
function send(
  event: string,
  object: Record<string, unknown>,
  token: string | null = TOKEN,
  id?: string,
) {
  const key = event.split("_")[0].toLowerCase();
  return handleWebhook(deps(), {
    tokenHeader: token,
    body: JSON.stringify({
      id: id ?? `evt_${++eventNumber}`,
      event,
      [key]: object,
    }),
  });
}

/** A Pix subscription with a trial, opened as the app opens one. */
async function pixRow() {
  await store.customer(PERSON, cpfHmac(CPF, KEY));
  const customer = await provider.createCustomer({
    name: "A",
    cpf: CPF,
    email: "a@example.com",
    reference: PERSON,
  });
  const sub = await provider.createPixSubscription({
    customerId: customer.id,
    valueCents: 1000,
    cycle: "monthly",
    firstDueOn: "2026-11-26",
    description: "x",
    reference: PERSON,
  });
  const rowId = await store.openSubscription({
    personId: PERSON,
    planId: "plan",
    cycle: "monthly",
    billingType: "pix",
    valueCents: 1000,
    withTrial: true,
    firstDueOn: "2026-11-26",
    checkoutId: null,
    customerId: customer.id,
    subscriptionId: sub.id,
  });
  const paymentId = [...provider.payments.values()][0].id;
  return { rowId, subscriptionId: sub.id, paymentId };
}

beforeEach(() => {
  provider = createFakeProvider();
  store = createFakeStore();
  confirmed = [];
  logged = [];
});

describe("handleWebhook", () => {
  test("refuses a missing or wrong token and reads nothing", async () => {
    const { subscriptionId } = await pixRow();
    for (const token of [null, "", "x".repeat(64), TOKEN.slice(1)]) {
      const result = await send(
        "SUBSCRIPTION_UPDATED",
        { id: subscriptionId },
        token,
      );
      assert.equal(result.status, 401);
    }
    assert.equal(store.events.size, 0);
  });

  test("a confirmed charge makes the subscription active and is passed on", async () => {
    const { rowId, subscriptionId, paymentId } = await pixRow();
    setPayment(provider, paymentId, {
      status: "CONFIRMED",
      paidOn: "2026-11-26",
    });
    const result = await send("PAYMENT_CONFIRMED", {
      id: paymentId,
      subscription: subscriptionId,
    });
    assert.equal(result.status, 200);
    const row = store.rows.get(rowId)!;
    assert.equal(row.status, "active");
    assert.equal(row.paidThrough, "2026-12-25");
    assert.deepEqual(confirmed, [paymentId]);
    assert.equal(store.payments.get(paymentId)?.asaasStatus, "CONFIRMED");
  });

  test("the state comes from the provider, not from the body", async () => {
    const { rowId, subscriptionId, paymentId } = await pixRow();
    // The body says paid; the provider says the charge is still pending.
    const result = await send("PAYMENT_RECEIVED", {
      id: paymentId,
      subscription: subscriptionId,
      status: "RECEIVED",
    });
    assert.equal(result.status, 200);
    assert.equal(store.rows.get(rowId)!.status, "trialing");
    assert.deepEqual(confirmed, []);
  });

  test("an event delivered again is handled once", async () => {
    const { subscriptionId, paymentId } = await pixRow();
    setPayment(provider, paymentId, { status: "CONFIRMED" });
    await send(
      "PAYMENT_CONFIRMED",
      { id: paymentId, subscription: subscriptionId },
      TOKEN,
      "evt_same",
    );
    const again = await send(
      "PAYMENT_CONFIRMED",
      { id: paymentId, subscription: subscriptionId },
      TOKEN,
      "evt_same",
    );
    assert.equal(again.status, 200);
    assert.equal(again.note, "already handled");
    assert.equal(confirmed.length, 1);
  });

  test("events out of order end in the same state", async () => {
    const { rowId, subscriptionId, paymentId } = await pixRow();
    setPayment(provider, paymentId, { status: "CONFIRMED" });
    // CONFIRMED arrives first, CREATED after it: both read the present.
    await send("PAYMENT_CONFIRMED", {
      id: paymentId,
      subscription: subscriptionId,
    });
    await send("PAYMENT_CREATED", {
      id: paymentId,
      subscription: subscriptionId,
    });
    assert.equal(store.rows.get(rowId)!.status, "active");
  });

  test("an overdue charge makes it past due", async () => {
    const { rowId, subscriptionId, paymentId } = await pixRow();
    setPayment(provider, paymentId, { status: "OVERDUE" });
    await send("PAYMENT_OVERDUE", {
      id: paymentId,
      subscription: subscriptionId,
    });
    const row = store.rows.get(rowId)!;
    assert.equal(row.status, "past_due");
    assert.equal(row.pastDueSince, "2026-11-26");
  });

  test("a passing failure answers 500 and is handled on the redelivery", async () => {
    const { rowId, subscriptionId, paymentId } = await pixRow();
    setPayment(provider, paymentId, { status: "CONFIRMED" });
    provider.failWith = new ProviderError("down", 503, []);
    const first = await send(
      "PAYMENT_CONFIRMED",
      { id: paymentId, subscription: subscriptionId },
      TOKEN,
      "evt_r",
    );
    assert.equal(first.status, 500);
    provider.failWith = null;
    const second = await send(
      "PAYMENT_CONFIRMED",
      { id: paymentId, subscription: subscriptionId },
      TOKEN,
      "evt_r",
    );
    assert.equal(second.status, 200);
    assert.equal(store.rows.get(rowId)!.status, "active");
  });

  test("the database down answers 500", async () => {
    await pixRow();
    store.failWith = new Error("connection refused");
    const result = await send("SUBSCRIPTION_UPDATED", { id: "sub_x" });
    assert.equal(result.status, 500);
  });

  test("what is not ours is set aside with 200, never a 500", async () => {
    const results = [
      await send("SUBSCRIPTION_UPDATED", { id: "sub_unknown" }),
      await send("PAYMENT_CREATED", { id: "pay_x" }),
      await send("CHECKOUT_PAID", { id: "chk_unknown" }),
      await send("ACCOUNT_STATUS_UPDATED", {}),
    ];
    for (const result of results) assert.equal(result.status, 200);
    assert.ok(
      [...store.events.values()].every(
        (event) => event.finished && event.error !== null,
      ),
    );
  });

  test("a body that is not an event answers 200 and keeps nothing", async () => {
    const notJson = await handleWebhook(deps(), {
      tokenHeader: TOKEN,
      body: "{",
    });
    const noId = await handleWebhook(deps(), {
      tokenHeader: TOKEN,
      body: JSON.stringify({ event: "X" }),
    });
    assert.equal(notJson.status, 200);
    assert.equal(noId.status, 200);
    assert.equal(store.events.size, 0);
  });

  test("a finished checkout links the subscription by its checkout and starts the trial", async () => {
    await store.customer(PERSON, cpfHmac(CPF, KEY));
    const checkout = await provider.createCardCheckout({
      itemName: "x",
      valueCents: 1000,
      cycle: "monthly",
      firstDueOn: "2026-11-26",
      reference: PERSON,
      returnUrl: "https://x",
      minutesToExpire: 60,
    });
    const rowId = await store.openSubscription({
      personId: PERSON,
      planId: "plan",
      cycle: "monthly",
      billingType: "card",
      valueCents: 1000,
      withTrial: true,
      firstDueOn: "2026-11-26",
      checkoutId: checkout.id,
      customerId: null,
      subscriptionId: null,
    });
    assert.equal(store.customers.get(PERSON)!.trialUsedAt, null);
    const made = finishCheckout(provider, {
      checkoutId: checkout.id,
      cpf: CPF,
      valueCents: 1000,
      firstDueOn: "2026-11-26",
    });
    const result = await send("SUBSCRIPTION_CREATED", {
      id: made.subscriptionId,
    });
    assert.equal(result.status, 200);
    const row = store.rows.get(rowId)!;
    assert.equal(row.status, "trialing");
    assert.equal(row.asaasSubscriptionId, made.subscriptionId);
    assert.notEqual(store.customers.get(PERSON)!.trialUsedAt, null);
  });

  test("a checkout finished with another CPF loses its trial and is deleted, uncharged", async () => {
    await store.customer(PERSON, cpfHmac(CPF, KEY));
    const rowId = await store.openSubscription({
      personId: PERSON,
      planId: "plan",
      cycle: "monthly",
      billingType: "card",
      valueCents: 1000,
      withTrial: true,
      firstDueOn: "2026-11-26",
      checkoutId: "chk_9",
      customerId: null,
      subscriptionId: null,
    });
    const made = finishCheckout(provider, {
      checkoutId: "chk_9",
      cpf: OTHER_CPF,
      valueCents: 1000,
      firstDueOn: "2026-11-26",
    });
    await send("SUBSCRIPTION_CREATED", { id: made.subscriptionId });
    const row = store.rows.get(rowId)!;
    assert.equal(row.status, "canceled");
    assert.equal(row.cancelReason, "trial_used");
    assert.equal(
      provider.subscriptions.get(made.subscriptionId)!.deleted,
      true,
    );
    assert.equal(provider.payments.get(made.paymentId)!.deleted, true);
    assert.equal(store.customers.get(PERSON)!.trialUsedAt, null);
  });

  test("a checkout that expires unfinished cancels the pending row", async () => {
    await store.customer(PERSON, cpfHmac(CPF, KEY));
    const rowId = await store.openSubscription({
      personId: PERSON,
      planId: "plan",
      cycle: "monthly",
      billingType: "card",
      valueCents: 1000,
      withTrial: true,
      firstDueOn: "2026-11-26",
      checkoutId: "chk_e",
      customerId: null,
      subscriptionId: null,
    });
    await send("CHECKOUT_EXPIRED", { id: "chk_e" });
    assert.equal(store.rows.get(rowId)!.status, "canceled");
    assert.equal(store.rows.get(rowId)!.cancelReason, "checkout_expired");
  });

  test("a subscription deleted at the provider is canceled here", async () => {
    const { rowId, subscriptionId } = await pixRow();
    await provider.deleteSubscription(subscriptionId);
    await send("SUBSCRIPTION_DELETED", { id: subscriptionId });
    assert.equal(store.rows.get(rowId)!.status, "canceled");
    assert.equal(store.rows.get(rowId)!.cancelReason, "provider");
  });

  // Review of #72, finding 1: a checkout left open after its row was
  // canceled (by her, or replaced by another subscription) could still be
  // paid, and the subscription it made ran with no row alive.
  test("a checkout finished after its row was canceled is undone at the provider", async () => {
    await store.customer(PERSON, cpfHmac(CPF, KEY));
    const rowId = await store.openSubscription({
      personId: PERSON,
      planId: "plan",
      cycle: "monthly",
      billingType: "card",
      valueCents: 1000,
      withTrial: false,
      firstDueOn: "2026-11-12",
      checkoutId: "chk_late",
      customerId: null,
      subscriptionId: null,
    });
    await store.applySubscription(rowId, {
      subscriptionId: null,
      customerId: null,
      status: "canceled",
      paidThrough: null,
      pastDueSince: null,
      cancelReason: "person",
    });
    const made = finishCheckout(provider, {
      checkoutId: "chk_late",
      cpf: CPF,
      valueCents: 1000,
      firstDueOn: "2026-11-12",
    });
    // No trial: the checkout charged at once.
    setPayment(provider, made.paymentId, { status: "CONFIRMED" });
    const result = await send("SUBSCRIPTION_CREATED", {
      id: made.subscriptionId,
    });
    assert.equal(result.status, 200);
    assert.equal(
      provider.subscriptions.get(made.subscriptionId)!.deleted,
      true,
    );
    assert.equal(provider.payments.get(made.paymentId)!.refundedCents, 1000);
    assert.equal(store.rows.get(rowId)!.status, "canceled");
    assert.deepEqual(confirmed, []);
  });

  // Finding 4: a failure every delivery meets again must not answer 500,
  // or one bad event stops the whole queue after 15.
  test("a refusal of the database or of the provider is set aside, not retried", async () => {
    const { subscriptionId, paymentId } = await pixRow();
    for (const cause of [
      new StoreRefusal("billing_payment_keeps_its_subscription", "moved"),
      new StoreError("23514", "billing_save_payment failed: check"),
      new ProviderError("bad request", 400, ["invalid"]),
      new Error("Asaas answered without a due date"),
    ]) {
      // Thrown in the middle of the handling, after the event was kept.
      provider.failWith = cause;
      const result = await send("PAYMENT_UPDATED", {
        id: paymentId,
        subscription: subscriptionId,
      });
      assert.equal(result.status, 200, cause.message);
    }
  });

  test("a network or connection failure is retried", async () => {
    const { subscriptionId, paymentId } = await pixRow();
    for (const cause of [
      new TypeError("fetch failed"),
      new StoreError(
        "",
        "billing_find_subscription failed: TypeError: fetch failed",
      ),
      Object.assign(new Error("The operation was aborted due to timeout"), {
        name: "TimeoutError",
      }),
    ]) {
      provider.failWith = cause;
      const result = await send("PAYMENT_UPDATED", {
        id: paymentId,
        subscription: subscriptionId,
      });
      assert.equal(result.status, 500, cause.message);
    }
  });
});
