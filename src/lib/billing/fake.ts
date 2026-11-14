/**
 * A provider and a store in memory, for the tests. They keep the contracts
 * the real ones keep where the code depends on them: a subscription's
 * charges belong to it, a deleted subscription takes its unpaid charges with
 * it, an event is handled until it is finished, an overdue step is taken
 * once, one subscription alive per person.
 */

import {
  ProviderError,
  type BillingProvider,
  type ProviderCustomer,
  type ProviderPayment,
  type ProviderSubscription,
} from "./provider.ts";
import {
  StoreRefusal,
  type BillingStore,
  type CreditDailyReport,
  type OverdueDay,
  type OverdueOutcome,
  type RefundQuote,
  type RefundStatus,
  type StoredSubscription,
} from "./store.ts";

export type FakeProvider = BillingProvider & {
  readonly customers: Map<string, ProviderCustomer>;
  readonly subscriptions: Map<string, ProviderSubscription>;
  readonly payments: Map<string, ProviderPayment>;
  readonly calls: string[];
  /** The status a charge paid again with its token ends in. */
  payAgainAnswer: string;
  /**
   * The status a refund is born with: DONE, or what the production account
   * answers while a critical event waits for the panel (Q3 A of #297).
   */
  refundAnswer: string;
  /** When set, every call fails with this error. */
  failWith: Error | null;
  /** Calls by name that fail with their error, once each. */
  readonly failOnce: Map<string, Error>;
};

export function createFakeProvider(): FakeProvider {
  let next = 1;
  const id = (prefix: string) => `${prefix}_${next++}`;
  const fake: FakeProvider = {
    customers: new Map(),
    subscriptions: new Map(),
    payments: new Map(),
    calls: [],
    payAgainAnswer: "CONFIRMED",
    refundAnswer: "DONE",
    failWith: null,
    failOnce: new Map(),

    async createCustomer({ name, cpf, email }) {
      track("createCustomer");
      const customer = { id: id("cus"), cpf, name, email };
      fake.customers.set(customer.id, customer);
      return { id: customer.id };
    },
    async getCustomer(customerId) {
      track("getCustomer");
      return found(fake.customers.get(customerId), customerId);
    },
    async createPixSubscription(input) {
      track("createPixSubscription");
      const subscription: ProviderSubscription = {
        id: id("sub"),
        customerId: input.customerId,
        status: "ACTIVE",
        deleted: false,
        nextDueOn: input.firstDueOn,
        checkoutId: null,
        valueCents: input.valueCents,
      };
      fake.subscriptions.set(subscription.id, subscription);
      addPayment(subscription, input.firstDueOn, null);
      return subscription;
    },
    async createCardCheckout() {
      track("createCardCheckout");
      const checkoutId = id("chk");
      return { id: checkoutId, url: `https://checkout.example/${checkoutId}` };
    },
    async getSubscription(subscriptionId) {
      track("getSubscription");
      return found(fake.subscriptions.get(subscriptionId), subscriptionId);
    },
    async listSubscriptionPayments(subscriptionId) {
      track("listSubscriptionPayments");
      return [...fake.payments.values()].filter(
        (payment) => payment.subscriptionId === subscriptionId,
      );
    },
    async getPayment(paymentId) {
      track("getPayment");
      return found(fake.payments.get(paymentId), paymentId);
    },
    async getPixCode(paymentId) {
      track("getPixCode");
      found(fake.payments.get(paymentId), paymentId);
      return { payload: `pix-${paymentId}`, imageBase64: "iVBORw0KGgo=" };
    },
    async deleteSubscription(subscriptionId) {
      track("deleteSubscription");
      const subscription = found(
        fake.subscriptions.get(subscriptionId),
        subscriptionId,
      );
      fake.subscriptions.set(subscriptionId, {
        ...subscription,
        deleted: true,
      });
      for (const payment of fake.payments.values()) {
        if (
          payment.subscriptionId === subscriptionId &&
          (payment.status === "PENDING" || payment.status === "OVERDUE")
        ) {
          fake.payments.set(payment.id, { ...payment, deleted: true });
        }
      }
    },
    async payWithCardToken(paymentId, cardToken) {
      track("payWithCardToken");
      const payment = found(fake.payments.get(paymentId), paymentId);
      if (payment.cardToken !== cardToken) {
        throw new ProviderError("token of another card", 400, [
          "invalid_token",
        ]);
      }
      const paid = {
        ...payment,
        status: fake.payAgainAnswer,
        paidOn: fake.payAgainAnswer === "CONFIRMED" ? payment.dueOn : null,
      };
      fake.payments.set(paymentId, paid);
      return paid;
    },
    async refund(paymentId, valueCents) {
      track("refund");
      const payment = found(fake.payments.get(paymentId), paymentId);
      const value = valueCents ?? payment.valueCents;
      // As the provider: the refunds of a charge never pass its value.
      const asked = payment.refunds
        .filter((refund) => refund.status !== "CANCELLED")
        .reduce((sum, refund) => sum + refund.valueCents, 0);
      if (asked + value > payment.valueCents) {
        throw new ProviderError("refunds above the charge", 400, [
          "invalid_value",
        ]);
      }
      const refunds = [
        ...payment.refunds,
        { status: fake.refundAnswer, valueCents: value },
      ];
      const after = {
        ...payment,
        refunds,
        refundedCents: refunds
          .filter((refund) => refund.status === "DONE")
          .reduce((sum, refund) => sum + refund.valueCents, 0),
      };
      fake.payments.set(paymentId, after);
      return after;
    },
    async updateSubscriptionValue(subscriptionId, valueCents) {
      track("updateSubscriptionValue");
      const subscription = found(
        fake.subscriptions.get(subscriptionId),
        subscriptionId,
      );
      fake.subscriptions.set(subscriptionId, { ...subscription, valueCents });
    },
  };

  function track(name: string): void {
    fake.calls.push(name);
    if (fake.failWith !== null) throw fake.failWith;
    const once = fake.failOnce.get(name);
    if (once !== undefined) {
      fake.failOnce.delete(name);
      throw once;
    }
  }

  function found<T>(value: T | undefined, what: string): T {
    if (value === undefined)
      throw new ProviderError(`${what} not found`, 404, ["not_found"]);
    return value;
  }

  function addPayment(
    subscription: ProviderSubscription,
    dueOn: string,
    cardToken: string | null,
  ): ProviderPayment {
    const payment: ProviderPayment = {
      id: id("pay"),
      subscriptionId: subscription.id,
      customerId: subscription.customerId,
      status: "PENDING",
      deleted: false,
      valueCents: subscription.valueCents,
      dueOn,
      paidOn: null,
      invoiceUrl: "https://invoice.example/i",
      refundedCents: 0,
      refunds: [],
      cardToken,
    };
    fake.payments.set(payment.id, payment);
    return payment;
  }

  return fake;
}

/** What the hosted checkout does when the person finishes it: the card subscription. */
export function finishCheckout(
  fake: FakeProvider,
  input: {
    checkoutId: string;
    cpf: string;
    valueCents: number;
    firstDueOn: string;
  },
): { customerId: string; subscriptionId: string; paymentId: string } {
  const customerId = `cus_chk_${input.checkoutId}`;
  fake.customers.set(customerId, {
    id: customerId,
    cpf: input.cpf,
    name: "Checkout",
    email: null,
  });
  const subscription: ProviderSubscription = {
    id: `sub_chk_${input.checkoutId}`,
    customerId,
    status: "ACTIVE",
    deleted: false,
    nextDueOn: input.firstDueOn,
    checkoutId: input.checkoutId,
    valueCents: input.valueCents,
  };
  fake.subscriptions.set(subscription.id, subscription);
  const paymentId = `pay_chk_${input.checkoutId}`;
  fake.payments.set(paymentId, {
    id: paymentId,
    subscriptionId: subscription.id,
    customerId,
    status: "PENDING",
    deleted: false,
    valueCents: input.valueCents,
    dueOn: input.firstDueOn,
    paidOn: null,
    invoiceUrl: "https://invoice.example/i",
    refundedCents: 0,
    refunds: [],
    cardToken: `tok_${input.checkoutId}`,
  });
  return { customerId, subscriptionId: subscription.id, paymentId };
}

export function setPayment(
  fake: FakeProvider,
  paymentId: string,
  change: Partial<ProviderPayment>,
): void {
  const payment = fake.payments.get(paymentId);
  if (payment === undefined) throw new Error(`no ${paymentId}`);
  fake.payments.set(paymentId, { ...payment, ...change });
}

type FakeEvent = { type: string; finished: boolean; error: string | null };

/** A row of refund_requests, as 0060 keeps it. */
export type FakeRefund = {
  readonly id: string;
  readonly personId: string;
  readonly paymentId: string;
  /** The subscription row the charge belongs to. */
  readonly subscriptionId: string;
  readonly refundCents: number;
  status: RefundStatus;
  asaasStatus: string | null;
  error: string | null;
  createdAt: string;
};
type FakePayment = Parameters<BillingStore["savePayment"]>[0];

export type FakeStore = BillingStore & {
  readonly rows: Map<
    string,
    StoredSubscription & {
      cancelReason: string | null;
      pastDueSince: string | null;
    }
  >;
  readonly customers: Map<
    string,
    { cpfHmac: string; trialUsedAt: string | null }
  >;
  readonly payments: Map<string, FakePayment>;
  readonly events: Map<string, FakeEvent>;
  readonly steps: Map<
    string,
    { outcome: OverdueOutcome | null; emailed: boolean }
  >;
  /** The charges settleCredits was called with, in order. */
  readonly settled: string[];
  /** What creditDaily answers. */
  dailyReport: CreditDailyReport;
  /** When set, settleCredits alone fails with this error. */
  settleFailWith: Error | null;
  /** When set, every call fails with this error. */
  failWith: Error | null;
  /**
   * When set, openSubscription refuses with this constraint, as the
   * database refuses a plan outside her audience or a value that is not
   * hers (0058).
   */
  refuseOpenWith: string | null;
  /**
   * What billing_refund_quote answers per person (0060): the database
   * decides the window and the value; the fake is told them.
   */
  readonly refundQuotes: Map<string, RefundQuote & { subscriptionId: string }>;
  readonly refunds: Map<string, FakeRefund>;
};

export function createFakeStore(): FakeStore {
  let next = 1;
  const store: FakeStore = {
    rows: new Map(),
    customers: new Map(),
    payments: new Map(),
    events: new Map(),
    steps: new Map(),
    settled: [],
    dailyReport: { granted: 0, closed: 0 },
    settleFailWith: null,
    failWith: null,
    refuseOpenWith: null,
    refundQuotes: new Map(),
    refunds: new Map(),

    async customer(personId, cpfHmac) {
      check();
      for (const [other, row] of store.customers) {
        if (other !== personId && row.cpfHmac === cpfHmac) {
          throw new StoreRefusal(
            "billing_customers_one_person_per_cpf",
            "CPF of another person",
          );
        }
      }
      const row = store.customers.get(personId);
      if (row === undefined) {
        store.customers.set(personId, { cpfHmac, trialUsedAt: null });
        return null;
      }
      if (row.cpfHmac !== cpfHmac) {
        throw new StoreRefusal(
          "billing_customers_one_cpf_per_person",
          "another CPF",
        );
      }
      return row.trialUsedAt;
    },

    async openSubscription(input) {
      check();
      if (store.refuseOpenWith !== null) {
        throw new StoreRefusal(store.refuseOpenWith, "refused by the database");
      }
      const customer = store.customers.get(input.personId);
      if (customer === undefined) throw new Error("no billing row");
      if (input.withTrial && customer.trialUsedAt !== null) {
        throw new StoreRefusal("billing_one_trial_per_person", "trial used");
      }
      for (const row of store.rows.values()) {
        if (row.personId === input.personId && row.status === "pending") {
          store.rows.set(row.id, {
            ...row,
            status: "canceled",
            cancelReason: "replaced",
          });
        }
      }
      if (
        [...store.rows.values()].some(
          (row) => row.personId === input.personId && row.status !== "canceled",
        )
      ) {
        throw new StoreRefusal(
          "subscriptions_one_alive_per_person",
          "one alive",
        );
      }
      const status =
        input.checkoutId !== null
          ? "pending"
          : input.withTrial
            ? "trialing"
            : "awaiting";
      const id = `row_${next++}`;
      store.rows.set(id, {
        id,
        personId: input.personId,
        planId: input.planId,
        cycle: input.cycle,
        billingType: input.billingType,
        valueCents: input.valueCents,
        withTrial: input.withTrial,
        firstDueOn: input.firstDueOn,
        status,
        asaasCheckoutId: input.checkoutId,
        asaasCustomerId: input.customerId,
        asaasSubscriptionId: input.subscriptionId,
        paidThrough: null,
        cancelReason: null,
        pastDueSince: null,
      });
      if (status === "trialing") customer.trialUsedAt = "now";
      return id;
    },

    async applySubscription(id, reading) {
      check();
      const row = store.rows.get(id);
      if (row === undefined) throw new Error(`no subscription ${id}`);
      if (row.status === "canceled") return;
      store.rows.set(id, {
        ...row,
        asaasSubscriptionId: reading.subscriptionId ?? row.asaasSubscriptionId,
        asaasCustomerId: reading.customerId ?? row.asaasCustomerId,
        status: reading.status,
        // As 0049: a reading replaces it, a cancel by the app keeps it.
        paidThrough:
          reading.status === "canceled"
            ? (reading.paidThrough ?? row.paidThrough)
            : reading.paidThrough,
        pastDueSince:
          reading.status === "past_due" ? reading.pastDueSince : null,
        cancelReason:
          reading.status === "canceled" ? reading.cancelReason : null,
      });
      const customer = store.customers.get(row.personId);
      if (
        reading.status !== "canceled" &&
        row.withTrial &&
        customer !== undefined
      ) {
        customer.trialUsedAt ??= "now";
      }
    },

    async findSubscription({ subscriptionId = null, checkoutId = null }) {
      check();
      for (const row of store.rows.values()) {
        if (
          (subscriptionId !== null &&
            row.asaasSubscriptionId === subscriptionId) ||
          (checkoutId !== null && row.asaasCheckoutId === checkoutId)
        ) {
          return row;
        }
      }
      return null;
    },

    async savePayment(input) {
      check();
      const before = store.payments.get(input.paymentId);
      if (
        before !== undefined &&
        before.subscriptionId !== input.subscriptionId
      ) {
        throw new StoreRefusal(
          "billing_payment_keeps_its_subscription",
          "moved",
        );
      }
      store.payments.set(input.paymentId, input);
    },

    async recordEvent(id, type) {
      check();
      const event = store.events.get(id) ?? {
        type,
        finished: false,
        error: null,
      };
      store.events.set(id, event);
      return !event.finished;
    },

    async finishEvent(id, error) {
      check();
      const event = store.events.get(id);
      if (event !== undefined)
        store.events.set(id, { ...event, finished: true, error });
    },

    async overduePayments() {
      check();
      return [...store.payments.values()]
        .filter(
          (payment) => payment.asaasStatus === "OVERDUE" && !payment.deleted,
        )
        .flatMap((payment) => {
          const row = store.rows.get(payment.subscriptionId);
          if (
            row === undefined ||
            row.status === "canceled" ||
            row.status === "pending"
          )
            return [];
          return [
            {
              paymentId: payment.paymentId,
              subscriptionId: row.id,
              personId: row.personId,
              billingType: row.billingType,
              dueOn: payment.dueOn,
              invoiceUrl: payment.invoiceUrl,
            },
          ];
        });
    },

    async takeOverdueStep(paymentId, day: OverdueDay) {
      check();
      const key = `${paymentId}|${day}`;
      // As 0049: a step that ended in error is taken again.
      if (store.steps.has(key) && store.steps.get(key)?.outcome !== "error") {
        return false;
      }
      store.steps.set(key, { outcome: null, emailed: false });
      return true;
    },

    async finishOverdueStep(paymentId, day, outcome, emailed) {
      check();
      store.steps.set(`${paymentId}|${day}`, { outcome, emailed });
    },

    async settleCredits(paymentId) {
      check();
      if (store.settleFailWith !== null) throw store.settleFailWith;
      // As 0050 reads it: the charge it settles is one already written.
      if (!store.payments.has(paymentId)) {
        throw new Error(`settled ${paymentId} before it was written`);
      }
      store.settled.push(paymentId);
    },

    async creditDaily() {
      check();
      return store.dailyReport;
    },

    async refundQuote(personId) {
      check();
      const quote = store.refundQuotes.get(personId);
      if (quote === undefined || taken(quote.paymentId)) return null;
      return {
        paymentId: quote.paymentId,
        endsAt: quote.endsAt,
        paymentCredits: quote.paymentCredits,
        unusedCredits: quote.unusedCredits,
        refundCents: quote.refundCents,
        lessonsAhead: quote.lessonsAhead,
      };
    },

    // As billing_open_refund (0060), in its order.
    async openRefund(personId) {
      check();
      if (
        [...store.refunds.values()].some(
          (refund) => refund.personId === personId && isOpen(refund.status),
        )
      ) {
        throw new StoreRefusal("refund_requests_one_open", "one open");
      }
      const quote = store.refundQuotes.get(personId);
      if (quote === undefined || taken(quote.paymentId)) {
        throw new StoreRefusal("billing_refund_window", "no charge");
      }
      if (quote.lessonsAhead > 0) {
        throw new StoreRefusal("billing_refund_lessons_ahead", "lesson");
      }
      if (quote.refundCents <= 0) {
        throw new StoreRefusal("billing_refund_nothing", "nothing");
      }
      const refund: FakeRefund = {
        id: `ref_${next++}`,
        personId,
        paymentId: quote.paymentId,
        subscriptionId: quote.subscriptionId,
        refundCents: quote.refundCents,
        status: "requested",
        asaasStatus: null,
        error: null,
        createdAt: new Date().toISOString(),
      };
      store.refunds.set(refund.id, refund);
      return {
        id: refund.id,
        paymentId: refund.paymentId,
        subscriptionId: refund.subscriptionId,
        refundCents: refund.refundCents,
      };
    },

    async refundFailed(id, error) {
      check();
      const refund = store.refunds.get(id);
      if (refund === undefined) throw new Error(`no refund ${id}`);
      if (isOpen(refund.status)) {
        refund.status = "failed";
        refund.error = error;
      }
      return refund.status;
    },

    // As billing_refund_reading (0060).
    async refundReading(paymentId, refunds) {
      check();
      const refund = [...store.refunds.values()].find(
        (each) => each.paymentId === paymentId && isOpen(each.status),
      );
      if (refund === undefined) return null;
      const statuses = refunds
        .filter((each) => each.valueCents === refund.refundCents)
        .map((each) => each.status);
      const written = store.payments.get(paymentId)?.refundedCents ?? 0;
      if (statuses.includes("DONE") && written >= refund.refundCents) {
        refund.status = "done";
        refund.asaasStatus = "DONE";
      } else if (statuses.some((status) => status !== "CANCELLED")) {
        refund.status = "sent";
        refund.asaasStatus =
          statuses.find((status) => status !== "CANCELLED") ?? null;
      } else if (statuses.length > 0) {
        refund.status = "failed";
        refund.asaasStatus = "CANCELLED";
        refund.error = "the provider canceled the refund";
      }
      return refund.status;
    },

    async openRefunds() {
      check();
      return [...store.refunds.values()]
        .filter((refund) => isOpen(refund.status))
        .map((refund) => ({
          id: refund.id,
          personId: refund.personId,
          status: refund.status as "requested" | "sent",
          createdAt: refund.createdAt,
          paymentId: refund.paymentId,
          asaasSubscriptionId:
            store.rows.get(refund.subscriptionId)?.asaasSubscriptionId ?? null,
        }));
    },
  };

  function isOpen(status: RefundStatus): boolean {
    return status === "requested" || status === "sent";
  }

  /** A charge with a request that did not fail is out of the window. */
  function taken(paymentId: string): boolean {
    return [...store.refunds.values()].some(
      (refund) => refund.paymentId === paymentId && refund.status !== "failed",
    );
  }

  function check(): void {
    if (store.failWith !== null) throw store.failWith;
  }

  return store;
}
