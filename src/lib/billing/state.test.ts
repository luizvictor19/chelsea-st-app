import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ProviderPayment, ProviderSubscription } from "./provider.ts";
import { readSubscription } from "./state.ts";

const SUB: ProviderSubscription = {
  id: "sub_1",
  customerId: "cus_1",
  status: "ACTIVE",
  deleted: false,
  nextDueOn: "2026-11-26",
  checkoutId: null,
  valueCents: 1000,
};

function payment(over: Partial<ProviderPayment>): ProviderPayment {
  return {
    id: "pay_1",
    subscriptionId: "sub_1",
    customerId: "cus_1",
    status: "PENDING",
    deleted: false,
    valueCents: 1000,
    dueOn: "2026-11-26",
    paidOn: null,
    invoiceUrl: null,
    refundedCents: 0,
    cardToken: null,
    ...over,
  };
}

const read = (
  payments: ProviderPayment[],
  sub: Partial<ProviderSubscription> = {},
  withTrial = true,
) =>
  readSubscription({
    withTrial,
    cycle: "monthly",
    subscription: { ...SUB, ...sub },
    payments,
  });

describe("readSubscription", () => {
  test("a trial with its first charge pending is trialing", () => {
    assert.deepEqual(read([payment({})]), {
      status: "trialing",
      paidThrough: null,
      pastDueSince: null,
    });
  });

  test("a confirmed charge makes it active through the day before the next", () => {
    assert.deepEqual(read([payment({ status: "CONFIRMED" })]), {
      status: "active",
      paidThrough: "2026-12-25",
      pastDueSince: null,
    });
    assert.equal(read([payment({ status: "RECEIVED" })]).status, "active");
  });

  test("an overdue charge makes it past due since its due day", () => {
    const reading = read([
      payment({ status: "CONFIRMED", id: "pay_0", dueOn: "2026-10-26" }),
      payment({ status: "OVERDUE" }),
    ]);
    assert.deepEqual(reading, {
      status: "past_due",
      paidThrough: "2026-11-25",
      pastDueSince: "2026-11-26",
    });
  });

  test("the oldest overdue charge is the one past due counts from", () => {
    const reading = read([
      payment({ status: "OVERDUE", id: "pay_2", dueOn: "2026-12-26" }),
      payment({ status: "OVERDUE" }),
    ]);
    assert.equal(reading.pastDueSince, "2026-11-26");
  });

  test("a deleted or inactive subscription is canceled", () => {
    assert.equal(read([payment({})], { deleted: true }).status, "canceled");
    assert.equal(
      read([payment({})], { status: "INACTIVE" }).status,
      "canceled",
    );
    assert.equal(read([payment({})], { status: "EXPIRED" }).status, "canceled");
  });

  test("a refunded or deleted charge pays for nothing", () => {
    assert.equal(read([payment({ status: "REFUNDED" })]).status, "trialing");
    assert.equal(
      read([payment({ status: "CONFIRMED", deleted: true })]).status,
      "trialing",
    );
    assert.equal(
      read([payment({ status: "OVERDUE", deleted: true })]).status,
      "trialing",
    );
  });

  test("with no trial an unpaid first charge is awaiting, never active", () => {
    // Review of #72: active before paying gave a Pix subscriber about eight
    // days of access, and a new subscription gave eight more, with nothing paid.
    assert.deepEqual(read([payment({})], {}, false), {
      status: "awaiting",
      paidThrough: null,
      pastDueSince: null,
    });
    assert.equal(
      read([payment({ status: "CONFIRMED" })], {}, false).status,
      "active",
    );
  });

  test("a charge of another subscription is not read", () => {
    assert.equal(
      read([payment({ status: "OVERDUE", subscriptionId: "sub_9" })]).status,
      "trialing",
    );
  });

  test("the same state whatever order the charges come in", () => {
    const a = payment({
      status: "CONFIRMED",
      id: "pay_0",
      dueOn: "2026-10-26",
    });
    const b = payment({ status: "CONFIRMED" });
    assert.deepEqual(read([a, b]), read([b, a]));
  });
});
