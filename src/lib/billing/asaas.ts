/**
 * The only file that knows the Asaas API (v3). Read on 12/11/2026 at
 * docs.asaas.com and probed in the sandbox the same day (#72):
 *
 * - The key goes in the access_token header; a User-Agent is required.
 * - Money is in reais with decimals; this side speaks cents.
 * - A card subscription made with a first due day 14 days ahead is created
 *   at once with that first charge PENDING on the day, the card's token on
 *   the charge (creditCard.creditCardToken). The checkout makes the same.
 * - A checkout with a customer id needs that customer's whole address; one
 *   with no customer at all lets the hosted page ask for everything. This
 *   module opens it with no customer, and the webhook reads the customer the
 *   provider made.
 * - A Pix subscription on an account with no Pix key comes back as BOLETO.
 *   That is the account's setting, not this code's; asaas.ts refuses it so a
 *   boleto is never sold as Pix.
 */

import type { AsaasConfig } from "./config.ts";
import {
  ProviderError,
  type BillingProvider,
  type Checkout,
  type Cycle,
  type PixCode,
  type ProviderCustomer,
  type ProviderPayment,
  type ProviderSubscription,
} from "./provider.ts";

// This module carries a secret, so it must never be bundled for the browser.
if (typeof window !== "undefined") {
  throw new Error(
    "billing/asaas.ts is server only and must not reach the browser",
  );
}

/** Per call. The webhook has 10 s in all before Asaas counts a failure. */
const TIMEOUT_MS = 8_000;
const USER_AGENT = "chelsea-st-app";

type Json = Record<string, unknown>;

function record(value: unknown): Json {
  return typeof value === "object" && value !== null ? (value as Json) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function required(value: unknown, what: string): string {
  const read = text(value);
  if (read === null) throw new Error(`Asaas answered without ${what}`);
  return read;
}

export function toCents(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `Asaas answered a value that is not a number: ${String(value)}`,
    );
  }
  return Math.round(value * 100);
}

export function toReais(cents: number): number {
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new Error(
      `A value in cents must be a positive whole number, got ${cents}`,
    );
  }
  return cents / 100;
}

const CYCLES: Record<Cycle, string> = { monthly: "MONTHLY", annual: "YEARLY" };

/** "2026-11-26" from "2026-11-26" or "2026-11-26 15:02:38". */
function day(value: unknown): string | null {
  const read = text(value);
  return read === null ? null : read.slice(0, 10);
}

export function readSubscription(body: unknown): ProviderSubscription {
  const value = record(body);
  return {
    id: required(value.id, "a subscription id"),
    customerId: required(value.customer, "a customer"),
    status: required(value.status, "a status"),
    deleted: value.deleted === true,
    nextDueOn: required(day(value.nextDueDate), "a next due date"),
    checkoutId: text(value.checkoutSession),
    valueCents: toCents(value.value),
  };
}

export function readPayment(body: unknown): ProviderPayment {
  const value = record(body);
  const refunds = Array.isArray(value.refunds) ? value.refunds : [];
  const refundedCents = refunds
    .map(record)
    .filter((refund) => refund.status === "DONE")
    .reduce((sum, refund) => sum + toCents(refund.value), 0);
  return {
    id: required(value.id, "a payment id"),
    subscriptionId: text(value.subscription),
    customerId: required(value.customer, "a customer"),
    status: required(value.status, "a status"),
    deleted: value.deleted === true,
    valueCents: toCents(value.value),
    dueOn: required(day(value.dueDate), "a due date"),
    paidOn: day(value.paymentDate) ?? day(value.clientPaymentDate),
    invoiceUrl: text(value.invoiceUrl),
    refundedCents,
    cardToken: text(record(value.creditCard).creditCardToken),
  };
}

export function createAsaasProvider(
  config: AsaasConfig,
  fetchImpl: typeof fetch = fetch,
): BillingProvider {
  async function call(
    method: string,
    path: string,
    body?: Json,
  ): Promise<unknown> {
    const response = await fetchImpl(`${config.baseUrl}${path}`, {
      method,
      headers: {
        access_token: config.apiKey,
        "content-type": "application/json",
        "user-agent": USER_AGENT,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const raw = await response.text();
    let parsed: unknown = null;
    try {
      parsed = raw === "" ? null : JSON.parse(raw);
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      const errors = Array.isArray(record(parsed).errors)
        ? (record(parsed).errors as unknown[]).map(record)
        : [];
      const codes = errors.map((error) => String(error.code ?? ""));
      const words = errors
        .map((error) => String(error.description ?? ""))
        .join("; ");
      throw new ProviderError(
        `Asaas ${method} ${path.split("?")[0]} failed: ${response.status}${
          response.status === 429 ? " (rate limit)" : ""
        } ${words}`.trim(),
        response.status,
        codes,
      );
    }
    return parsed;
  }

  return {
    async createCustomer({ name, cpf, email, reference }) {
      const body = await call("POST", "/customers", {
        name,
        cpfCnpj: cpf,
        email,
        externalReference: reference,
      });
      return { id: required(record(body).id, "a customer id") };
    },

    async getCustomer(id): Promise<ProviderCustomer> {
      const value = record(
        await call("GET", `/customers/${encodeURIComponent(id)}`),
      );
      return {
        id: required(value.id, "a customer id"),
        cpf: text(value.cpfCnpj),
        name: text(value.name) ?? "",
        email: text(value.email),
      };
    },

    async createPixSubscription(input) {
      const body = await call("POST", "/subscriptions", {
        customer: input.customerId,
        billingType: "PIX",
        value: toReais(input.valueCents),
        nextDueDate: input.firstDueOn,
        cycle: CYCLES[input.cycle],
        description: input.description,
        externalReference: input.reference,
      });
      if (record(body).billingType !== "PIX") {
        // Asaas made it, as something else: undo it before refusing, or it
        // bills the person every cycle with no row of ours behind it.
        const made = text(record(body).id);
        if (made !== null) {
          await call("DELETE", `/subscriptions/${encodeURIComponent(made)}`);
        }
        throw new ProviderError(
          `Asaas made the subscription as ${String(record(body).billingType)}, not PIX: the account needs a Pix key`,
          200,
          ["not_pix"],
        );
      }
      return readSubscription(body);
    },

    async createCardCheckout(input): Promise<Checkout> {
      const body = record(
        await call("POST", "/checkouts", {
          billingTypes: ["CREDIT_CARD"],
          chargeTypes: ["RECURRENT"],
          minutesToExpire: input.minutesToExpire,
          externalReference: input.reference,
          callback: {
            successUrl: input.returnUrl,
            cancelUrl: input.returnUrl,
            expiredUrl: input.returnUrl,
          },
          items: [
            {
              name: input.itemName.slice(0, 30),
              quantity: 1,
              value: toReais(input.valueCents),
            },
          ],
          subscription: {
            cycle: CYCLES[input.cycle],
            nextDueDate: input.firstDueOn,
          },
        }),
      );
      return {
        id: required(body.id, "a checkout id"),
        url: required(body.link, "a checkout link"),
      };
    },

    async getSubscription(id) {
      return readSubscription(
        await call("GET", `/subscriptions/${encodeURIComponent(id)}`),
      );
    },

    async listSubscriptionPayments(subscriptionId) {
      const body = record(
        await call(
          "GET",
          `/subscriptions/${encodeURIComponent(subscriptionId)}/payments?limit=100`,
        ),
      );
      const data = Array.isArray(body.data) ? body.data : [];
      return data.map(readPayment);
    },

    async getPayment(id) {
      return readPayment(
        await call("GET", `/payments/${encodeURIComponent(id)}`),
      );
    },

    async getPixCode(paymentId): Promise<PixCode> {
      const value = record(
        await call(
          "GET",
          `/payments/${encodeURIComponent(paymentId)}/pixQrCode`,
        ),
      );
      return {
        payload: required(value.payload, "a Pix payload"),
        imageBase64: required(value.encodedImage, "a Pix image"),
      };
    },

    async deleteSubscription(id) {
      await call("DELETE", `/subscriptions/${encodeURIComponent(id)}`);
    },

    async payWithCardToken(paymentId, cardToken) {
      return readPayment(
        await call(
          "POST",
          `/payments/${encodeURIComponent(paymentId)}/payWithCreditCard`,
          {
            creditCardToken: cardToken,
          },
        ),
      );
    },

    async refund(paymentId, valueCents) {
      await call(
        "POST",
        `/payments/${encodeURIComponent(paymentId)}/refund`,
        valueCents === undefined ? {} : { value: toReais(valueCents) },
      );
    },

    async updateSubscriptionValue(id, valueCents) {
      await call("PUT", `/subscriptions/${encodeURIComponent(id)}`, {
        value: toReais(valueCents),
        updatePendingPayments: false,
      });
    },
  };
}
