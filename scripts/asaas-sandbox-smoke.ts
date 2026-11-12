/**
 * Passes src/lib/billing/asaas.ts through the real sandbox (#72), and writes
 * every answer to fixtures/asaas/smoke-<date>.jsonl as it arrives. Free: it
 * is the sandbox, and it refuses a production key.
 *
 *   node scripts/asaas-sandbox-smoke.ts
 *
 * What it does, in order: a customer with a made-up CPF; a Pix subscription
 * with its first charge 14 days ahead; its charges and the QR of the first;
 * the sandbox's own confirmation of that charge, read back as paid; a partial
 * refund of it; the subscription deleted; a card checkout opened, whose link
 * it prints for a person to finish with a test card. A Pix subscription on an
 * account without a Pix key comes back as boleto, and the run says so.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { createAsaasProvider } from "../src/lib/billing/asaas.ts";
import { addDays, billingDay } from "../src/lib/billing/dates.ts";
import { loadAsaasEnv } from "./asaas-env.ts";

const { config } = loadAsaasEnv();
if (!config.sandbox) {
  console.error("Sandbox key only.");
  process.exit(1);
}
const provider = createAsaasProvider(config);

const dir = join(import.meta.dirname, "..", "fixtures", "asaas");
mkdirSync(dir, { recursive: true });
const today = billingDay(new Date());
const out = join(dir, `smoke-${today}.jsonl`);

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

const firstDueOn = addDays(today, 14);
const customer = await step("customer", () =>
  provider.createCustomer({
    name: "Smoke Sandbox",
    cpf: madeUpCpf(),
    email: "smoke@example.com",
    reference: "smoke",
  }),
);
const pix =
  customer &&
  (await step("pix subscription, first charge in 14 days", () =>
    provider.createPixSubscription({
      customerId: customer.id,
      valueCents: 1000,
      cycle: "monthly",
      firstDueOn,
      description: "smoke",
      reference: "smoke",
    }),
  ));
const charges =
  pix &&
  (await step("charges of the subscription", () =>
    provider.listSubscriptionPayments(pix.id),
  ));
const first = charges?.[0] ?? null;
if (first !== null) {
  await step("pix code", () => provider.getPixCode(first.id));
  await step("sandbox confirms the charge", async () => {
    const response = await fetch(
      `${config.baseUrl}/sandbox/payment/${first.id}/confirm`,
      {
        method: "POST",
        headers: {
          access_token: config.apiKey,
          "user-agent": "chelsea-st-app",
        },
      },
    );
    if (!response.ok)
      throw new Error(`${response.status} ${await response.text()}`);
    return provider.getPayment(first.id);
  });
  await step("partial refund", () => provider.refund(first.id, 300));
  await step("charge after the refund", () => provider.getPayment(first.id));
}
if (pix)
  await step("delete the subscription", () =>
    provider.deleteSubscription(pix.id),
  );

const checkout = await step("card checkout", () =>
  provider.createCardCheckout({
    itemName: "Smoke",
    valueCents: 1000,
    cycle: "monthly",
    firstDueOn,
    reference: "smoke",
    returnUrl: "https://example.com/plano",
    minutesToExpire: 60,
  }),
);
if (checkout) {
  console.log(
    `\nFinish the checkout with the test card 4539 6560 4839 2220: ${checkout.url}`,
  );
}
console.log(`\nWritten to ${out}`);
