/**
 * Passes the partial refund of the withdrawal (#297) through the real
 * sandbox, for a Pix charge and a card charge, and writes every answer to
 * fixtures/asaas/refund-<date>.jsonl as it arrives. Free: it is the sandbox,
 * and it refuses a production key. It writes no database.
 *
 *   node scripts/asaas-refund-smoke.ts
 *   node scripts/asaas-refund-smoke.ts --refund <payment id>
 *
 * With --refund it only asks for the partial refund of that charge and reads
 * it back: a card partial refund goes only from the day after the charge on
 * (measured on 14/11/2026), so a charge made one day is refunded the next.
 *
 * What it does, in order: a customer with a made-up CPF; a Pix subscription
 * whose first charge is due today, confirmed by the sandbox; a card charge
 * paid at once with the sandbox's test card; a partial refund of each,
 * through src/lib/billing/asaas.ts, with the value and the reason, tried
 * again while the sandbox says the charge is too fresh to refund; each
 * charge read back with its refunds; the subscription deleted. Made-up
 * numbers: 1000 cents charged, 429 back.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { createAsaasProvider } from "../src/lib/billing/asaas.ts";
import { billingDay } from "../src/lib/billing/dates.ts";
import { REFUND_DESCRIPTION } from "../src/lib/billing/messages.ts";
import { ProviderError } from "../src/lib/billing/provider.ts";
import { loadAsaasEnv, option } from "./asaas-env.ts";

const { config } = loadAsaasEnv();
if (!config.sandbox) {
  console.error("Sandbox key only.");
  process.exit(1);
}
const provider = createAsaasProvider(config);

const CHARGE_CENTS = 1000;
const BACK_CENTS = 429;
/** The sandbox refuses a refund right after the confirmation (#72). */
const TRIES = 10;
const WAIT_MS = 20_000;

const dir = join(import.meta.dirname, "..", "fixtures", "asaas");
mkdirSync(dir, { recursive: true });
const today = billingDay(new Date());
const out = join(dir, `refund-${today}.jsonl`);

function write(step: string, result: unknown, error: unknown = null): void {
  appendFileSync(
    out,
    `${JSON.stringify({
      at: new Date().toISOString(),
      step,
      result,
      error: error === null ? null : String(error),
    })}\n`,
  );
  console.log(
    error === null ? `ok   ${step}` : `FAIL ${step}: ${String(error)}`,
  );
}

async function step<T>(name: string, run: () => Promise<T>): Promise<T | null> {
  try {
    const result = await run();
    write(name, result);
    return result;
  } catch (cause) {
    write(name, null, cause);
    return null;
  }
}

async function api(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: {
      access_token: config.apiKey,
      "content-type": "application/json",
      "user-agent": "chelsea-st-app",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text}`);
  return text === "" ? null : JSON.parse(text);
}

/** A CPF with valid check digits, made up for the sandbox. */
function madeUpCpf(): string {
  const digits = Array.from({ length: 9 }, () =>
    Math.floor(Math.random() * 10),
  );
  const check = (length: number) => {
    const sum = digits
      .slice(0, length)
      .reduce((total, digit, i) => total + digit * (length + 1 - i), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  digits.push(check(9));
  digits.push(check(10));
  return digits.join("");
}

/** The partial refund, again while the sandbox says it is too soon. */
async function partialRefund(kind: string, paymentId: string): Promise<void> {
  for (let attempt = 1; attempt <= TRIES; attempt += 1) {
    try {
      const after = await provider.refund(
        paymentId,
        BACK_CENTS,
        REFUND_DESCRIPTION,
      );
      write(`${kind}: partial refund, try ${attempt}`, after);
      return;
    } catch (cause) {
      write(`${kind}: partial refund, try ${attempt}`, null, cause);
      if (!(cause instanceof ProviderError) || cause.status >= 500) return;
      await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
    }
  }
}

const only = option("refund");
if (only !== null) {
  await partialRefund("given", only);
  await step("given: the charge after the refund", () =>
    provider.getPayment(only),
  );
  console.log(`\nWritten to ${out}`);
  process.exit(0);
}

const cpf = madeUpCpf();
const customer = await step("customer", () =>
  provider.createCustomer({
    name: "Refund Sandbox",
    cpf,
    email: "refund-smoke@example.com",
    reference: "refund-smoke",
  }),
);
if (customer === null) process.exit(1);

// Pix: a subscription with its first charge today, confirmed by the sandbox.
const pix = await step("pix subscription, first charge today", () =>
  provider.createPixSubscription({
    customerId: customer.id,
    valueCents: CHARGE_CENTS,
    cycle: "monthly",
    firstDueOn: today,
    description: "refund smoke",
    reference: "refund-smoke",
  }),
);
const pixCharge =
  pix === null
    ? null
    : ((
        await step("pix charges", () =>
          provider.listSubscriptionPayments(pix.id),
        )
      )?.[0] ?? null);
if (pixCharge !== null) {
  await step("pix: the sandbox confirms the charge", async () => {
    await api(`/sandbox/payment/${pixCharge.id}/confirm`, {});
    return provider.getPayment(pixCharge.id);
  });
  await partialRefund("pix", pixCharge.id);
  await step("pix: the charge after the refund", () =>
    provider.getPayment(pixCharge.id),
  );
}
if (pix !== null) {
  await step("pix: delete the subscription", () =>
    provider.deleteSubscription(pix.id),
  );
}

// Card: a charge paid at once with the sandbox's test card.
const card = await step("card: a charge paid with the test card", async () => {
  const body = (await api("/payments", {
    customer: customer.id,
    billingType: "CREDIT_CARD",
    value: CHARGE_CENTS / 100,
    dueDate: today,
    description: "refund smoke",
    creditCard: {
      holderName: "Refund Sandbox",
      number: "4539656048392220",
      expiryMonth: "12",
      expiryYear: String(new Date().getFullYear() + 3),
      ccv: "123",
    },
    creditCardHolderInfo: {
      name: "Refund Sandbox",
      email: "refund-smoke@example.com",
      cpfCnpj: cpf,
      postalCode: "01310100",
      addressNumber: "100",
      phone: "11999999999",
    },
  })) as { id: string };
  return provider.getPayment(body.id);
});
if (card !== null) {
  await partialRefund("card", card.id);
  await step("card: the charge after the refund", () =>
    provider.getPayment(card.id),
  );
}

console.log(`\nWritten to ${out}`);
