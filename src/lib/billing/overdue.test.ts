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
import type { Email } from "../mail/mailer.ts";
import { overdueEmail } from "./messages.ts";
import { overdueStep, runOverdue, type OverdueDeps } from "./overdue.ts";

const KEY = "k".repeat(64);
const PERSON = "person-1";
const DUE = "2026-11-26";

let provider: FakeProvider;
let store: FakeStore;
let sent: Email[];

function deps(today: string, over: Partial<OverdueDeps> = {}): OverdueDeps {
  return {
    provider,
    store,
    mailer: { send: async (email) => void sent.push(email) },
    today,
    emailOf: async () => "a@example.com",
    appUrl: "https://app.example",
    log: () => {},
    ...over,
  };
}

/** A subscription whose first charge, due on DUE, is overdue. */
async function overdue(billingType: "card" | "pix") {
  await store.customer(PERSON, cpfHmac("52998224725", KEY));
  let subscriptionId: string;
  let paymentId: string;
  if (billingType === "card") {
    const made = finishCheckout(provider, {
      checkoutId: "chk_1",
      cpf: "52998224725",
      valueCents: 1000,
      firstDueOn: DUE,
    });
    subscriptionId = made.subscriptionId;
    paymentId = made.paymentId;
  } else {
    const sub = await provider.createPixSubscription({
      customerId: "cus_1",
      valueCents: 1000,
      cycle: "monthly",
      firstDueOn: DUE,
      description: "x",
      reference: PERSON,
    });
    subscriptionId = sub.id;
    paymentId = [...provider.payments.values()].find(
      (p) => p.subscriptionId === sub.id,
    )!.id;
  }
  const rowId = await store.openSubscription({
    personId: PERSON,
    planId: "plan",
    cycle: "monthly",
    billingType,
    valueCents: 1000,
    withTrial: true,
    firstDueOn: DUE,
    checkoutId: null,
    customerId: "cus_1",
    subscriptionId,
  });
  setPayment(provider, paymentId, { status: "OVERDUE" });
  await store.savePayment({
    paymentId,
    subscriptionId: rowId,
    valueCents: 1000,
    asaasStatus: "OVERDUE",
    deleted: false,
    dueOn: DUE,
    paidAt: null,
    refundedCents: 0,
    invoiceUrl: "https://invoice.example/i",
  });
  return { rowId, subscriptionId, paymentId };
}

beforeEach(() => {
  provider = createFakeProvider();
  store = createFakeStore();
  sent = [];
});

describe("overdueStep", () => {
  test("days 1, 3, 5 and 7 after the due day, and the latest one missed", () => {
    assert.equal(overdueStep(DUE, "2026-11-26"), null);
    assert.equal(overdueStep(DUE, "2026-11-27"), 1);
    assert.equal(overdueStep(DUE, "2026-11-28"), 1);
    assert.equal(overdueStep(DUE, "2026-11-29"), 3);
    assert.equal(overdueStep(DUE, "2026-12-01"), 5);
    assert.equal(overdueStep(DUE, "2026-12-03"), 7);
    assert.equal(overdueStep(DUE, "2026-12-20"), 7);
  });
});

describe("runOverdue", () => {
  test("card, day 1: charges again with the saved card and writes no e-mail when it passes", async () => {
    const { paymentId } = await overdue("card");
    const report = await runOverdue(deps("2026-11-27"));
    assert.equal(report.taken, 1);
    assert.deepEqual(report.outcomes, { paid: 1 });
    assert.equal(provider.payments.get(paymentId)!.status, "CONFIRMED");
    assert.equal(sent.length, 0);
  });

  test("card refused: an e-mail saying how many days are left", async () => {
    await overdue("card");
    provider.payAgainAnswer = "OVERDUE";
    const report = await runOverdue(deps("2026-11-29"));
    assert.deepEqual(report.outcomes, { refused: 1 });
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /Faltam 4 dias/);
    assert.match(sent[0].text, /cartão/);
  });

  test("the same day twice charges and writes once", async () => {
    await overdue("card");
    provider.payAgainAnswer = "OVERDUE";
    await runOverdue(deps("2026-11-27"));
    const second = await runOverdue(deps("2026-11-27"));
    assert.equal(second.taken, 0);
    assert.equal(
      provider.calls.filter((call) => call === "payWithCardToken").length,
      1,
    );
    assert.equal(sent.length, 1);
  });

  test("Pix: no charge, the e-mail with the link", async () => {
    await overdue("pix");
    const report = await runOverdue(deps("2026-11-27"));
    assert.deepEqual(report.outcomes, { pix_reminder: 1 });
    assert.equal(provider.calls.includes("payWithCardToken"), false);
    assert.match(sent[0].text, /Pix/);
    assert.match(sent[0].text, /invoice\.example/);
  });

  test("day 7 unpaid: canceled at the provider and here, and the last e-mail", async () => {
    const { rowId, subscriptionId } = await overdue("card");
    provider.payAgainAnswer = "OVERDUE";
    const report = await runOverdue(deps("2026-12-03"));
    assert.deepEqual(report.outcomes, { canceled: 1 });
    assert.equal(provider.subscriptions.get(subscriptionId)!.deleted, true);
    assert.equal(store.rows.get(rowId)!.status, "canceled");
    assert.equal(store.rows.get(rowId)!.cancelReason, "overdue");
    assert.match(sent[0].subject, /cancelada/);
  });

  test("day 7 with the card passing does not cancel", async () => {
    const { rowId } = await overdue("card");
    await runOverdue(deps("2026-12-03"));
    assert.notEqual(store.rows.get(rowId)!.status, "canceled");
  });

  test("paid since the last reading: nothing charged, nothing sent", async () => {
    const { paymentId } = await overdue("pix");
    setPayment(provider, paymentId, { status: "RECEIVED" });
    const report = await runOverdue(deps("2026-11-27"));
    assert.deepEqual(report.outcomes, { already_paid: 1 });
    assert.equal(sent.length, 0);
  });

  test("a charge paid on day 1 is found paid on day 3, whatever else fails", async () => {
    await overdue("card");
    const report = await runOverdue(
      deps("2026-11-27", {
        mailer: {
          send: async () => {
            throw new Error("mail down");
          },
        },
      }),
    );
    provider.payAgainAnswer = "OVERDUE";
    assert.deepEqual(report.outcomes, { paid: 1 });
    const failing = await runOverdue(
      deps("2026-11-29", {
        emailOf: async () => {
          throw new Error("auth down");
        },
      }),
    );
    // The charge was paid on day 1, so day 3 finds it paid.
    assert.deepEqual(failing.outcomes, { already_paid: 1 });
  });

  test("an error in a step is kept, not thrown", async () => {
    await overdue("pix");
    const report = await runOverdue(
      deps("2026-11-27", {
        mailer: {
          send: async () => {
            throw new Error("mail down");
          },
        },
      }),
    );
    assert.deepEqual(report.outcomes, { error: 1 });
    assert.deepEqual([...store.steps.values()][0], {
      outcome: "error",
      emailed: false,
    });
  });

  test("a person with no e-mail gets the step without one", async () => {
    await overdue("pix");
    const report = await runOverdue(
      deps("2026-11-27", { emailOf: async () => null }),
    );
    assert.deepEqual(report.outcomes, { pix_reminder: 1 });
    assert.equal(sent.length, 0);
  });
});

// Review of #72, finding 2: a step that failed was never taken again, so a
// provider out on day 7 left the subscription running for good.
describe("runOverdue after a failure", () => {
  test("day 7 with the provider out is taken again on the next run and cancels", async () => {
    const { rowId, subscriptionId } = await overdue("card");
    provider.payAgainAnswer = "OVERDUE";
    provider.failOnce.set("deleteSubscription", new Error("503"));
    const first = await runOverdue(deps("2026-12-03"));
    assert.deepEqual(first.outcomes, { error: 1 });
    assert.notEqual(store.rows.get(rowId)!.status, "canceled");
    const second = await runOverdue(deps("2026-12-04"));
    assert.deepEqual(second.outcomes, { canceled: 1 });
    assert.equal(provider.subscriptions.get(subscriptionId)!.deleted, true);
    assert.equal(store.rows.get(rowId)!.status, "canceled");
    assert.equal(store.rows.get(rowId)!.cancelReason, "overdue");
  });

  test("day 7 whose deletion went through and whose writing did not still cancels here", async () => {
    const { rowId, subscriptionId } = await overdue("pix");
    // The provider already deleted it, and with it the overdue charge.
    await provider.deleteSubscription(subscriptionId);
    const report = await runOverdue(deps("2026-12-03"));
    assert.deepEqual(report.outcomes, { canceled: 1 });
    assert.equal(store.rows.get(rowId)!.status, "canceled");
    assert.match(sent[0].subject, /cancelada/);
  });
});

describe("overdueEmail", () => {
  test("one day left is singular, and the plan link stands in for a missing invoice", () => {
    const email = overdueEmail({
      day: 5,
      lastDay: 6,
      billingType: "pix",
      canceled: false,
      invoiceUrl: null,
      planUrl: "https://app.example/dashboard/plano",
    });
    assert.match(email.text, /Faltam 1 dia /);
    assert.match(email.text, /dashboard\/plano/);
  });
});
