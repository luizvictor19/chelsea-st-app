import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  createAsaasProvider,
  readPayment,
  readSubscription,
  toCents,
  toReais,
} from "./asaas.ts";
import { SANDBOX_URL } from "./config.ts";
import { ProviderError } from "./provider.ts";

type Sent = { url: string; init: RequestInit };

function fakeFetch(status: number, body: unknown, sent: Sent[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
}

const CONFIG = { apiKey: "$aact_hmlg_k", baseUrl: SANDBOX_URL, sandbox: true };

// A charge as the sandbox answered on 12/11/2026, trimmed.
const PAYMENT = {
  object: "payment",
  id: "pay_0_egp9e02js10lq2",
  customer: "cus_000009939988",
  subscription: "sub_lheat2br3etdi71s",
  value: 10,
  status: "PENDING",
  dueDate: "2026-11-26",
  paymentDate: null,
  invoiceUrl: "https://sandbox.asaas.com/i/0_egp9e02js10lq2",
  deleted: false,
  creditCard: {
    creditCardNumber: "2220",
    creditCardBrand: "VISA",
    creditCardToken: "d0c39dc8-1057-49f3-9da9-a684c8822768",
  },
  refunds: null,
};

describe("asaas", () => {
  test("cents and reais", () => {
    assert.equal(toCents(10), 1000);
    assert.equal(toCents(14.7), 1470);
    assert.equal(toCents(0.1 + 0.2), 30);
    assert.equal(toReais(1470), 14.7);
    assert.throws(() => toReais(0));
    assert.throws(() => toReais(10.5));
    assert.throws(() => toCents("10"));
  });

  test("reads a charge, with its card token and only done refunds", () => {
    assert.deepEqual(readPayment(PAYMENT), {
      id: "pay_0_egp9e02js10lq2",
      subscriptionId: "sub_lheat2br3etdi71s",
      customerId: "cus_000009939988",
      status: "PENDING",
      deleted: false,
      valueCents: 1000,
      dueOn: "2026-11-26",
      paidOn: null,
      invoiceUrl: "https://sandbox.asaas.com/i/0_egp9e02js10lq2",
      refundedCents: 0,
      refunds: [],
      cardToken: "d0c39dc8-1057-49f3-9da9-a684c8822768",
    });
    const refunded = readPayment({
      ...PAYMENT,
      status: "REFUNDED",
      paymentDate: "2026-11-26",
      refunds: [
        { status: "DONE", value: 3 },
        { status: "PENDING", value: 2 },
      ],
    });
    assert.equal(refunded.refundedCents, 300);
    assert.deepEqual(refunded.refunds, [
      { status: "DONE", valueCents: 300 },
      { status: "PENDING", valueCents: 200 },
    ]);
    assert.equal(refunded.paidOn, "2026-11-26");
  });

  test("reads a subscription and its checkout", () => {
    const sub = readSubscription({
      id: "sub_1",
      customer: "cus_1",
      status: "ACTIVE",
      nextDueDate: "2026-12-26",
      value: 10,
      checkoutSession: "510ef9b1",
      deleted: false,
    });
    assert.equal(sub.checkoutId, "510ef9b1");
    assert.equal(sub.valueCents, 1000);
    assert.throws(() => readSubscription({ id: "sub_1" }), /customer/);
  });

  test("sends the key in access_token, a user agent, and reais", async () => {
    const sent: Sent[] = [];
    const provider = createAsaasProvider(
      CONFIG,
      fakeFetch(
        200,
        {
          id: "sub_1",
          customer: "cus_1",
          status: "ACTIVE",
          nextDueDate: "2026-11-26",
          value: 14.7,
          billingType: "PIX",
        },
        sent,
      ),
    );
    await provider.createPixSubscription({
      customerId: "cus_1",
      valueCents: 1470,
      cycle: "annual",
      firstDueOn: "2026-11-26",
      description: "Plano",
      reference: "ref",
    });
    const headers = sent[0].init.headers as Record<string, string>;
    assert.equal(sent[0].url, `${SANDBOX_URL}/subscriptions`);
    assert.equal(headers.access_token, "$aact_hmlg_k");
    assert.equal(headers["user-agent"], "chelsea-st-app");
    const body = JSON.parse(String(sent[0].init.body));
    assert.equal(body.value, 14.7);
    assert.equal(body.cycle, "YEARLY");
    assert.equal(body.billingType, "PIX");
  });

  // Review of #72, finding 3: the boleto subscription Asaas made stayed
  // there, billing every cycle, with no row in the database.
  test("a Pix subscription made as boleto is deleted before it is refused", async () => {
    const sent: Sent[] = [];
    const provider = createAsaasProvider(
      CONFIG,
      fakeFetch(
        200,
        {
          id: "sub_b",
          customer: "cus_1",
          status: "ACTIVE",
          nextDueDate: "2026-11-26",
          value: 10,
          billingType: "BOLETO",
        },
        sent,
      ),
    );
    await assert.rejects(
      provider.createPixSubscription({
        customerId: "cus_1",
        valueCents: 1000,
        cycle: "monthly",
        firstDueOn: "2026-11-26",
        description: "x",
        reference: "r",
      }),
      /Pix key/,
    );
    assert.equal(sent[1]?.init.method, "DELETE");
    assert.match(sent[1]?.url ?? "", /\/subscriptions\/sub_b$/);
  });

  test("a Pix subscription made as boleto is refused", async () => {
    const provider = createAsaasProvider(
      CONFIG,
      fakeFetch(
        200,
        {
          id: "sub_1",
          customer: "cus_1",
          status: "ACTIVE",
          nextDueDate: "2026-11-26",
          value: 10,
          billingType: "BOLETO",
        },
        [],
      ),
    );
    await assert.rejects(
      provider.createPixSubscription({
        customerId: "cus_1",
        valueCents: 1000,
        cycle: "monthly",
        firstDueOn: "2026-11-26",
        description: "x",
        reference: "r",
      }),
      /Pix key/,
    );
  });

  test("the checkout carries no customer, the card cycle and the return", async () => {
    const sent: Sent[] = [];
    const provider = createAsaasProvider(
      CONFIG,
      fakeFetch(
        200,
        { id: "chk_1", link: "https://sandbox.asaas.com/c/chk_1" },
        sent,
      ),
    );
    const checkout = await provider.createCardCheckout({
      itemName: "Um nome de plano longo demais para o item",
      valueCents: 1000,
      cycle: "monthly",
      firstDueOn: "2026-11-26",
      reference: "sub-row",
      returnUrl: "https://app.chelsea-st.com/dashboard/plano",
      minutesToExpire: 60,
    });
    assert.deepEqual(checkout, {
      id: "chk_1",
      url: "https://sandbox.asaas.com/c/chk_1",
    });
    const body = JSON.parse(String(sent[0].init.body));
    assert.equal(body.customer, undefined);
    assert.equal(body.customerData, undefined);
    assert.deepEqual(body.billingTypes, ["CREDIT_CARD"]);
    assert.deepEqual(body.chargeTypes, ["RECURRENT"]);
    assert.deepEqual(body.subscription, {
      cycle: "MONTHLY",
      nextDueDate: "2026-11-26",
    });
    assert.equal(body.items[0].name.length, 30);
    assert.equal(
      body.callback.successUrl,
      "https://app.chelsea-st.com/dashboard/plano",
    );
  });

  test("a refusal becomes a ProviderError with the codes, a 429 says so", async () => {
    const provider = createAsaasProvider(
      CONFIG,
      fakeFetch(
        400,
        {
          errors: [
            {
              code: "invalid_object",
              description: "O campo phone deve existir.",
            },
          ],
        },
        [],
      ),
    );
    await assert.rejects(provider.getPayment("pay_1"), (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.status, 400);
      assert.deepEqual(error.codes, ["invalid_object"]);
      assert.match(error.message, /phone/);
      return true;
    });
    const limited = createAsaasProvider(CONFIG, fakeFetch(429, {}, []));
    await assert.rejects(limited.getPayment("pay_1"), /rate limit/);
  });

  test("a partial refund sends the value and the reason, a whole one sends none, and the charge comes back", async () => {
    const sent: Sent[] = [];
    const answer = {
      ...PAYMENT,
      status: "RECEIVED",
      paymentDate: "2026-11-26",
      refunds: [
        {
          status: "AWAITING_CRITICAL_ACTION_AUTHORIZATION",
          value: 2.5,
          dateCreated: "2026-11-26 10:00:00",
        },
      ],
    };
    const provider = createAsaasProvider(CONFIG, fakeFetch(200, answer, sent));
    const read = await provider.refund("pay_1", 250, "CDC art. 49");
    await provider.refund("pay_1");
    assert.deepEqual(JSON.parse(String(sent[0].init.body)), {
      value: 2.5,
      description: "CDC art. 49",
    });
    assert.deepEqual(JSON.parse(String(sent[1].init.body)), {});
    assert.match(sent[0].url, /\/payments\/pay_1\/refund$/);
    assert.deepEqual(read.refunds, [
      { status: "AWAITING_CRITICAL_ACTION_AUTHORIZATION", valueCents: 250 },
    ]);
    assert.equal(read.refundedCents, 0);
  });

  test("a charge is paid again with the token alone", async () => {
    const sent: Sent[] = [];
    const provider = createAsaasProvider(
      CONFIG,
      fakeFetch(200, { ...PAYMENT, status: "CONFIRMED" }, sent),
    );
    const paid = await provider.payWithCardToken("pay_1", "tok");
    assert.equal(paid.status, "CONFIRMED");
    assert.deepEqual(JSON.parse(String(sent[0].init.body)), {
      creditCardToken: "tok",
    });
  });
});
