import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { cpfHmac } from "./cpf.ts";
import {
  createFakeProvider,
  createFakeStore,
  setPayment,
  type FakeProvider,
  type FakeStore,
} from "./fake.ts";
import { REFUND_DESCRIPTION, REFUND_REFUSALS } from "./messages.ts";
import { ProviderError } from "./provider.ts";
import { syncSubscription } from "./sync.ts";
import {
  reconcileRefunds,
  REFUND_LATER,
  REFUND_SETTLE_MINUTES,
  refundLater,
  withdraw,
  type WithdrawDeps,
} from "./withdraw.ts";

// Made-up numbers: a charge of 1000 cents, 429 back.
const KEY = "k".repeat(64);
const CPF = "52998224725";
const PERSON = "person-1";
const VALUE = 1000;
const BACK = 429;

let provider: FakeProvider;
let store: FakeStore;
let notices: string[];
let logged: string[];

function deps(): WithdrawDeps {
  return {
    provider,
    store,
    cpfKey: KEY,
    notify: async (paymentId) => {
      notices.push(paymentId);
    },
    log: (line) => logged.push(line),
  };
}

/** An active Pix subscription whose first charge is paid, and its quote. */
async function paidRow() {
  await store.customer(PERSON, cpfHmac(CPF, KEY));
  const customer = await provider.createCustomer({
    name: "A",
    cpf: CPF,
    email: "a@example.com",
    reference: PERSON,
  });
  const sub = await provider.createPixSubscription({
    customerId: customer.id,
    valueCents: VALUE,
    cycle: "monthly",
    firstDueOn: "2026-11-14",
    description: "x",
    reference: PERSON,
  });
  const rowId = await store.openSubscription({
    personId: PERSON,
    planId: "plan",
    cycle: "monthly",
    billingType: "pix",
    valueCents: VALUE,
    withTrial: false,
    firstDueOn: "2026-11-14",
    checkoutId: null,
    customerId: customer.id,
    subscriptionId: sub.id,
  });
  const paymentId = [...provider.payments.values()][0].id;
  setPayment(provider, paymentId, {
    status: "RECEIVED",
    paidOn: "2026-11-14",
  });
  await syncSubscription(deps(), store.rows.get(rowId)!, sub.id);
  store.refundQuotes.set(PERSON, {
    paymentId,
    subscriptionId: rowId,
    endsAt: "2026-11-22T03:00:00Z",
    paymentCredits: 7,
    unusedCredits: 3,
    refundCents: BACK,
    lessonsAhead: 0,
  });
  return { rowId, subscriptionId: sub.id, paymentId };
}

function current(rowId: string) {
  return store.rows.get(rowId)!;
}

function onlyRefund() {
  const all = [...store.refunds.values()];
  assert.equal(all.length, 1);
  return all[0];
}

beforeEach(() => {
  provider = createFakeProvider();
  store = createFakeStore();
  notices = [];
  logged = [];
});

describe("withdraw", () => {
  test("asks the provider for the database's value, then cancels, and waits for the panel", async () => {
    const { rowId, subscriptionId, paymentId } = await paidRow();
    provider.refundAnswer = "AWAITING_CRITICAL_ACTION_AUTHORIZATION";
    const result = await withdraw(deps(), {
      personId: PERSON,
      current: current(rowId),
    });
    assert.deepEqual(result, { kind: "sent" });
    assert.deepEqual(provider.payments.get(paymentId)!.refunds, [
      { status: "AWAITING_CRITICAL_ACTION_AUTHORIZATION", valueCents: BACK },
    ]);
    assert.equal(onlyRefund().status, "sent");
    assert.equal(
      onlyRefund().asaasStatus,
      "AWAITING_CRITICAL_ACTION_AUTHORIZATION",
    );
    // The refund before the cancel, the cancel only after it was taken.
    assert.deepEqual(
      provider.calls.filter(
        (call) => call === "refund" || call === "deleteSubscription",
      ),
      ["refund", "deleteSubscription"],
    );
    assert.equal(provider.subscriptions.get(subscriptionId)!.deleted, true);
    assert.equal(current(rowId).status, "canceled");
    assert.equal(current(rowId).cancelReason, "person");
    assert.deepEqual(notices, [paymentId]);
  });

  // Review of #297: a refund DONE at once must not end the request before
  // the charge is written with the money back and its lots voided.
  test("a refund done at once writes the charge and settles it before the request ends", async () => {
    const { rowId, paymentId } = await paidRow();
    store.settled.length = 0;
    const result = await withdraw(deps(), {
      personId: PERSON,
      current: current(rowId),
    });
    assert.deepEqual(result, { kind: "done" });
    assert.equal(store.payments.get(paymentId)?.refundedCents, BACK);
    assert.deepEqual(store.settled, [paymentId]);
    assert.equal(onlyRefund().status, "done");
    assert.equal(current(rowId).status, "canceled");
    assert.deepEqual(notices, []);
  });

  test("a DONE read before the charge is written keeps the request sent", async () => {
    const { paymentId } = await paidRow();
    await store.openRefund(PERSON);
    const status = await store.refundReading(paymentId, [
      { status: "DONE", valueCents: BACK },
    ]);
    assert.equal(status, "sent");
  });

  test("an answer with no refund of the value leaves the request to the routine", async () => {
    const { rowId } = await paidRow();
    provider.refund = async (id) => provider.getPayment(id);
    const result = await withdraw(deps(), {
      personId: PERSON,
      current: current(rowId),
    });
    assert.deepEqual(result, { kind: "pending" });
    assert.equal(onlyRefund().status, "requested");
    assert.equal(current(rowId).status, "active");
  });

  test("a refund canceled at once says so and cancels nothing", async () => {
    const { rowId } = await paidRow();
    provider.refundAnswer = "CANCELLED";
    const result = await withdraw(deps(), {
      personId: PERSON,
      current: current(rowId),
    });
    assert.deepEqual(result, {
      kind: "refused",
      message: REFUND_REFUSALS.provider_refused,
    });
    assert.equal(onlyRefund().status, "failed");
    assert.equal(current(rowId).status, "active");
  });

  // Review of #297: once the provider took the refund, a failure of ours
  // never tells her to try again.
  test("the database down after the refund was taken still answers sent", async () => {
    const { rowId } = await paidRow();
    provider.refundAnswer = "PENDING";
    const reading = store.refundReading.bind(store);
    store.refundReading = async () => {
      throw new Error("database down");
    };
    const result = await withdraw(deps(), {
      personId: PERSON,
      current: current(rowId),
    });
    assert.deepEqual(result, { kind: "sent" });
    assert.equal(current(rowId).status, "canceled");
    assert.ok(logged.some((line) => line.includes("left to the routine")));
    store.refundReading = reading;
    await reconcileRefunds({
      ...deps(),
      now: new Date(Date.now() + (REFUND_SETTLE_MINUTES + 1) * 60_000),
    });
    assert.equal(onlyRefund().status, "sent");
  });

  test("the reason goes with the refund", async () => {
    const { rowId, paymentId } = await paidRow();
    const asked: unknown[] = [];
    const refund = provider.refund.bind(provider);
    provider.refund = async (id, cents, description) => {
      asked.push([id, cents, description]);
      return refund(id, cents, description);
    };
    await withdraw(deps(), { personId: PERSON, current: current(rowId) });
    assert.deepEqual(asked, [[paymentId, BACK, REFUND_DESCRIPTION]]);
  });

  test("a refusal of the provider fails the request and cancels nothing", async () => {
    const { rowId, subscriptionId } = await paidRow();
    provider.failOnce.set(
      "refund",
      new ProviderError("saldo insuficiente", 400, ["insufficient_balance"]),
    );
    const result = await withdraw(deps(), {
      personId: PERSON,
      current: current(rowId),
    });
    assert.deepEqual(result, {
      kind: "refused",
      message: REFUND_REFUSALS.provider_refused,
    });
    assert.equal(onlyRefund().status, "failed");
    assert.match(onlyRefund().error ?? "", /saldo insuficiente/);
    assert.equal(current(rowId).status, "active");
    assert.equal(provider.subscriptions.get(subscriptionId)!.deleted, false);
    assert.deepEqual(notices, []);
  });

  test("after a refusal she asks again", async () => {
    const { rowId } = await paidRow();
    provider.failOnce.set("refund", new ProviderError("x", 400, []));
    await withdraw(deps(), { personId: PERSON, current: current(rowId) });
    const again = await withdraw(deps(), {
      personId: PERSON,
      current: current(rowId),
    });
    assert.deepEqual(again, { kind: "done" });
    assert.deepEqual(
      [...store.refunds.values()].map((refund) => refund.status),
      ["failed", "done"],
    );
  });

  test("an answer lost leaves the request requested and cancels nothing", async () => {
    for (const cause of [
      new ProviderError("down", 503, []),
      new ProviderError("slow down", 429, []),
      new TypeError("fetch failed"),
    ]) {
      provider = createFakeProvider();
      store = createFakeStore();
      const { rowId } = await paidRow();
      provider.failOnce.set("refund", cause);
      const result = await withdraw(deps(), {
        personId: PERSON,
        current: current(rowId),
      });
      assert.deepEqual(result, { kind: "pending" });
      assert.equal(onlyRefund().status, "requested");
      assert.equal(current(rowId).status, "active");
    }
  });

  test("a second click never asks the provider twice", async () => {
    const { rowId } = await paidRow();
    provider.refundAnswer = "PENDING";
    await withdraw(deps(), { personId: PERSON, current: current(rowId) });
    const second = await withdraw(deps(), {
      personId: PERSON,
      current: current(rowId),
    });
    assert.deepEqual(second, {
      kind: "refused",
      message: REFUND_REFUSALS.refund_requests_one_open,
    });
    assert.equal(provider.calls.filter((call) => call === "refund").length, 1);
  });

  test("each refusal of the database is said in its sentence", async () => {
    await paidRow();
    store.refundQuotes.set(PERSON, {
      ...store.refundQuotes.get(PERSON)!,
      lessonsAhead: 1,
    });
    assert.deepEqual(
      await withdraw(deps(), { personId: PERSON, current: null }),
      {
        kind: "refused",
        message: REFUND_REFUSALS.billing_refund_lessons_ahead,
      },
    );
    store.refundQuotes.delete(PERSON);
    assert.deepEqual(
      await withdraw(deps(), { personId: PERSON, current: null }),
      {
        kind: "refused",
        message: REFUND_REFUSALS.billing_refund_window,
      },
    );
    assert.equal(provider.calls.includes("refund"), false);
  });

  test("a subscription already canceled is not canceled again", async () => {
    const { rowId, subscriptionId } = await paidRow();
    // She canceled first, within the 7 days, as the screen does it.
    await provider.deleteSubscription(subscriptionId);
    provider.calls.length = 0;
    await store.applySubscription(rowId, {
      subscriptionId: null,
      customerId: null,
      status: "canceled",
      paidThrough: null,
      pastDueSince: null,
      cancelReason: "person",
    });
    const result = await withdraw(deps(), {
      personId: PERSON,
      current: current(rowId),
    });
    assert.deepEqual(result, { kind: "done" });
    assert.equal(provider.calls.includes("deleteSubscription"), false);
  });

  test("a cancel that fails after the refund was taken is left to the routine", async () => {
    const { rowId } = await paidRow();
    provider.refundAnswer = "PENDING";
    provider.failOnce.set(
      "deleteSubscription",
      new ProviderError("down", 503, []),
    );
    const result = await withdraw(deps(), {
      personId: PERSON,
      current: current(rowId),
    });
    assert.deepEqual(result, { kind: "sent" });
    assert.equal(current(rowId).status, "active");
    await reconcileRefunds({ ...deps(), now: new Date() });
    assert.equal(current(rowId).status, "canceled");
  });
});

// The two answers the sandbox gave on 14/11/2026 to a refund asked too
// soon (fixtures/asaas/refund-2026-11-14.jsonl): a Pix right after its
// confirmation, a card partial refund on the day of the charge.
const TOO_SOON = new ProviderError(
  "Asaas POST /payments/pay_1/refund failed: 400 Não é possível solicitar estorno para essa cobrança no momento. Tente novamente em alguns instantes.",
  400,
  [""],
  [
    "Não é possível solicitar estorno para essa cobrança no momento. Tente novamente em alguns instantes.",
  ],
);
const NEXT_DAY = new ProviderError(
  "Asaas POST /payments/pay_1/refund failed: 400 Esta transação só pode ser estornada parcialmente no próximo dia.",
  400,
  [""],
  ["Esta transação só pode ser estornada parcialmente no próximo dia."],
);

describe("a refund the provider takes only later", () => {
  test("refundLater knows the two answers, and nothing else", () => {
    assert.equal(refundLater(TOO_SOON), true);
    assert.equal(refundLater(NEXT_DAY), true);
    // A stray space or line break at the provider still matches.
    assert.equal(
      refundLater(
        new ProviderError(
          "x",
          400,
          [],
          [
            "  Esta transação só pode ser\n estornada parcialmente no próximo dia. ",
          ],
        ),
      ),
      true,
    );
    for (const cause of [
      new ProviderError("x", 400, [], ["Valor inválido."]),
      new ProviderError("x", 500, [], [REFUND_LATER[1]]),
      new ProviderError(REFUND_LATER[1], 400, []),
      new Error(REFUND_LATER[0]),
    ]) {
      assert.equal(refundLater(cause), false);
    }
  });

  test("each of the two answers keeps the request open, cancels nothing and says it goes later", async () => {
    for (const cause of [TOO_SOON, NEXT_DAY]) {
      provider = createFakeProvider();
      store = createFakeStore();
      const { rowId } = await paidRow();
      provider.failOnce.set("refund", cause);
      const result = await withdraw(deps(), {
        personId: PERSON,
        current: current(rowId),
      });
      assert.deepEqual(result, { kind: "deferred" });
      assert.equal(onlyRefund().status, "requested");
      assert.equal(current(rowId).status, "active");
      assert.deepEqual(notices, []);
    }
  });

  test("the routine sends it on a later day, and only then cancels", async () => {
    const { rowId, paymentId } = await paidRow();
    provider.failOnce.set("refund", NEXT_DAY);
    await withdraw(deps(), { personId: PERSON, current: current(rowId) });
    const later = new Date(Date.now() + (REFUND_SETTLE_MINUTES + 1) * 60_000);

    // Still the same day at the provider: asked again, refused again, kept.
    provider.failOnce.set("refund", NEXT_DAY);
    let report = await reconcileRefunds({ ...deps(), now: later });
    assert.equal(onlyRefund().status, "requested");
    assert.equal(report.waiting, 1);
    assert.equal(current(rowId).status, "active");

    // The next day: taken.
    provider.refundAnswer = "AWAITING_CRITICAL_ACTION_AUTHORIZATION";
    report = await reconcileRefunds({ ...deps(), now: later });
    assert.equal(onlyRefund().status, "sent");
    assert.equal(current(rowId).status, "canceled");
    assert.deepEqual(provider.payments.get(paymentId)!.refunds, [
      { status: "AWAITING_CRITICAL_ACTION_AUTHORIZATION", valueCents: BACK },
    ]);
    assert.deepEqual(notices, [paymentId]);
  });

  test("another refusal of the provider still fails the request", async () => {
    const { rowId } = await paidRow();
    provider.failOnce.set(
      "refund",
      new ProviderError("x", 400, ["invalid_value"], ["Valor inválido."]),
    );
    const result = await withdraw(deps(), {
      personId: PERSON,
      current: current(rowId),
    });
    assert.equal(result.kind, "refused");
    assert.equal(onlyRefund().status, "failed");
  });
});

describe("reconcileRefunds", () => {
  const later = () =>
    new Date(Date.now() + (REFUND_SETTLE_MINUTES + 1) * 60_000);

  test("a request whose refund reached the provider is sent, and the subscription canceled", async () => {
    const { rowId, paymentId } = await paidRow();
    provider.refundAnswer = "PENDING";
    // The call went through, and its answer was lost on the way back.
    const refund = provider.refund.bind(provider);
    provider.refund = async (id, cents, description) => {
      await refund(id, cents, description);
      throw new TypeError("fetch failed");
    };
    await withdraw(deps(), { personId: PERSON, current: current(rowId) });
    assert.equal(onlyRefund().status, "requested");

    // Too young: the call may still be on its way.
    let report = await reconcileRefunds({ ...deps(), now: new Date() });
    assert.equal(report.read, 0);
    assert.equal(onlyRefund().status, "requested");

    report = await reconcileRefunds({ ...deps(), now: later() });
    assert.equal(report.waiting, 1);
    assert.equal(onlyRefund().status, "sent");
    assert.equal(current(rowId).status, "canceled");
    assert.equal(provider.payments.get(paymentId)!.refunds.length, 1);
  });

  test("a request that never reached the provider is asked for by the routine, after checking, once", async () => {
    const { rowId, paymentId } = await paidRow();
    provider.failOnce.set("refund", new TypeError("fetch failed"));
    await withdraw(deps(), { personId: PERSON, current: current(rowId) });
    assert.equal(onlyRefund().status, "requested");
    const report = await reconcileRefunds({ ...deps(), now: later() });
    assert.equal(report.done, 1);
    assert.equal(onlyRefund().status, "done");
    assert.equal(current(rowId).status, "canceled");
    assert.deepEqual(provider.payments.get(paymentId)!.refunds, [
      { status: "DONE", valueCents: BACK },
    ]);
    // Read before it was asked again: one refund at the provider.
    const calls = provider.calls.filter(
      (call) => call === "getPayment" || call === "refund",
    );
    assert.deepEqual(calls.slice(-2), ["getPayment", "refund"]);
  });

  test("the routine fails a request the provider refuses for good", async () => {
    const { rowId } = await paidRow();
    provider.failOnce.set("refund", new TypeError("fetch failed"));
    await withdraw(deps(), { personId: PERSON, current: current(rowId) });
    provider.failOnce.set(
      "refund",
      new ProviderError("x", 400, ["invalid_value"], ["Valor inválido."]),
    );
    const report = await reconcileRefunds({ ...deps(), now: later() });
    assert.equal(report.failed, 1);
    assert.equal(onlyRefund().status, "failed");
    assert.equal(current(rowId).status, "active");
  });

  test("a refund done later makes it done, and the charge is written refunded and settled", async () => {
    const { rowId, paymentId } = await paidRow();
    provider.refundAnswer = "AWAITING_CRITICAL_ACTION_AUTHORIZATION";
    await withdraw(deps(), { personId: PERSON, current: current(rowId) });
    // Luiz authorizes in the panel.
    setPayment(provider, paymentId, {
      refunds: [{ status: "DONE", valueCents: BACK }],
      refundedCents: BACK,
    });
    store.settled.length = 0;
    const report = await reconcileRefunds({ ...deps(), now: new Date() });
    assert.equal(report.done, 1);
    assert.equal(onlyRefund().status, "done");
    assert.equal(store.payments.get(paymentId)?.refundedCents, BACK);
    assert.deepEqual(store.settled, [paymentId]);
    assert.equal(current(rowId).status, "canceled");
  });

  test("a refund canceled at the provider fails the request", async () => {
    const { rowId, paymentId } = await paidRow();
    provider.refundAnswer = "AWAITING_CRITICAL_ACTION_AUTHORIZATION";
    await withdraw(deps(), { personId: PERSON, current: current(rowId) });
    setPayment(provider, paymentId, {
      refunds: [{ status: "CANCELLED", valueCents: BACK }],
    });
    const report = await reconcileRefunds({ ...deps(), now: new Date() });
    assert.equal(report.failed, 1);
    assert.equal(onlyRefund().status, "failed");
  });

  test("a failure on one request is counted and the others still run", async () => {
    const { rowId } = await paidRow();
    provider.refundAnswer = "PENDING";
    await withdraw(deps(), { personId: PERSON, current: current(rowId) });
    provider.failOnce.set("getPayment", new ProviderError("down", 503, []));
    const report = await reconcileRefunds({ ...deps(), now: new Date() });
    assert.equal(report.errors, 1);
    assert.equal(
      logged.some((line) => line.includes("could not be read")),
      true,
    );
  });
});

describe("the webhook reads the refund", () => {
  test("a charge read with its refund done moves the open request to done", async () => {
    const { rowId, subscriptionId, paymentId } = await paidRow();
    provider.refundAnswer = "PENDING";
    await withdraw(deps(), { personId: PERSON, current: current(rowId) });
    setPayment(provider, paymentId, {
      refunds: [{ status: "DONE", valueCents: BACK }],
      refundedCents: BACK,
    });
    // The row is canceled by now: the charge is still written (#302).
    await syncSubscription(deps(), current(rowId), subscriptionId);
    assert.equal(onlyRefund().status, "done");
    assert.equal(store.payments.get(paymentId)?.refundedCents, BACK);
  });
});
